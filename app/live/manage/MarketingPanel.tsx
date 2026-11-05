"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { SendRecord } from "@/lib/aws/sends"
import type { NewsletterItem } from "@/lib/aws/newsletters"
import { Spinner } from "@/components/ui/spinner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/components/ui/sonner"
import { apiFetch, errorMessage, NetworkError } from "@/lib/api-fetch"
import { canResume, isActiveState, sendCounts, sendState, type DeliveryStatus, type SendLike } from "@/lib/bulk-send"
import type { SendSummary } from "@/lib/aws/sends"
import { SendMonitor, type LiveState } from "./SendMonitor"
import { Button } from "@/components/ui/button"

type ContactList = { name: string; description?: string }
type Contact = { email: string; unsubscribed: boolean }

const DEFAULT_REPLY_TO = "void.ultimate@gmail.com"
const DEFAULT_FROM_NAME = "Void Ultimate"

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Recipient count plus the send's real state (in progress / stopped partway / cancelled…). */
function SendStatusCell({ s, onOpen }: { s: SendRecord; onOpen: () => void }) {
  const state = sendState(s as SendLike)
  const { sent, total } = sendCounts(s as SendLike)
  if (s.sendMode === "test" || state === "legacy") return <span className="font-mono tabular-nums">{s.recipientCount}</span>
  const label =
    state === "queued" ? "Queued"
    : state === "sending" ? `Sending · ${sent}/${total || "…"}`
    : state === "stopped" ? `Stopped · ${sent}/${total}`
    : state === "failed" ? `Failed · ${sent}/${total}`
    : state === "cancelled" ? `Cancelled · ${sent}/${total}`
    : s.sendMode === "dryrun" ? `Dry run · ${sent}`
    : null
  if (!label) return <span className="font-mono tabular-nums">{sent}</span>
  const tone = isActiveState(state) ? "text-fg-secondary border-border" : state === "failed" ? "text-destructive border-destructive/30" : "text-warning border-warning/30"
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`text-[11px] border rounded-full px-2 py-0.5 font-mono tabular-nums hover:bg-surface-2 transition-colors ${tone}`}
      title={canResume(s as SendLike) ? "Open to resume" : "Open progress"}
    >
      {label}
    </button>
  )
}

export function MarketingPanel() {
  const router = useRouter()
  const [lists, setLists] = useState<ContactList[]>([])
  const [sends, setSends] = useState<SendRecord[]>([])
  const [newsletters, setNewsletters] = useState<NewsletterItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // New list form
  const [newListName, setNewListName] = useState("")
  const [newListDesc, setNewListDesc] = useState("")
  const [creatingList, setCreatingList] = useState(false)
  const [pendingDeleteList, setPendingDeleteList] = useState<string | null>(null)
  const [deletingList, setDeletingList] = useState(false)

  // Contacts modal
  const [contactsModal, setContactsModal] = useState<string | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsError, setContactsError] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState("")
  const [addingContact, setAddingContact] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState("")
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ added: string[]; skipped: string[]; failed: { email: string; reason: string }[] } | null>(null)

  // Send dialog
  const [sendDialog, setSendDialog] = useState<string | null>(null)
  const [selectedNewsletterId, setSelectedNewsletterId] = useState("")
  const [subject, setSubject] = useState("")
  const [replyTo, setReplyTo] = useState(DEFAULT_REPLY_TO)
  const [fromName, setFromName] = useState(DEFAULT_FROM_NAME)
  const [includeWebLink, setIncludeWebLink] = useState(true)
  const [trackingEnabled, setTrackingEnabled] = useState(true)
  const [testEmail, setTestEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState("")
  const [testResult, setTestResult] = useState("")
  const [confirmSend, setConfirmSend] = useState(false)

  const [testSendId, setTestSendId] = useState<string | null>(null)

  // TOTP prompt
  const [totpPromptCallback, setTotpPromptCallback] = useState<((code: string) => void) | null>(null)
  const [totpInput, setTotpInput] = useState("")
  const [totpError, setTotpError] = useState("")

  // Send progress monitor (reads the stored record, so it survives reloads; ?send=<id> deep-links it)
  const [monitor, setMonitor] = useState<{
    sendId: string | null
    title: string
    listName: string
    live: LiveState
  } | null>(null)
  const [workerEnabled, setWorkerEnabled] = useState(false)

  // Delivery modal: per-recipient status as recorded, never inferred from the current list
  type DeliveryRecipient = { email: string; status: DeliveryStatus }
  const [deliveryModal, setDeliveryModal] = useState<{
    send: SendRecord
    recipients: DeliveryRecipient[] | null
    source: "worker" | "record" | "none" | null
    loading: boolean
    error?: string
    resending: boolean
    resendProgress: { recipients: Map<string, "pending" | "sent" | "failed">; sent: number; failed: number; total: number; done: boolean } | null
  } | null>(null)

  async function openDelivery(s: SendRecord) {
    setDeliveryModal({ send: s, recipients: null, source: null, loading: true, resending: false, resendProgress: null })
    const order: Record<DeliveryStatus, number> = { failed: 0, unknown: 1, pending: 2, sent: 3, dryrun: 4 }
    try {
      const res = await apiFetch(`/api/marketing/sends/${encodeURIComponent(s.id)}/recipients`)
      if (!res.ok) {
        const message = await errorMessage(res, "Couldn't load delivery details.")
        setDeliveryModal(prev => prev ? { ...prev, loading: false, error: message } : null)
        return
      }
      const data = await res.json() as { source: "worker" | "record" | "none"; recipients: DeliveryRecipient[] }
      const recipients = [...data.recipients].sort((a, b) =>
        a.status === b.status ? a.email.localeCompare(b.email) : order[a.status] - order[b.status])
      setDeliveryModal(prev => prev ? { ...prev, recipients, source: data.source, loading: false } : null)
    } catch {
      setDeliveryModal(prev => prev ? { ...prev, loading: false, error: "Can't reach the server. Check your connection." } : null)
    }
  }

  async function resendFailed(totpCode: string) {
    if (!deliveryModal) return
    const { send } = deliveryModal
    const failedEmails = (send.failedRecipients ?? [])
    if (failedEmails.length === 0) return

    setDeliveryModal(prev => prev ? {
      ...prev,
      resending: true,
      resendProgress: {
        recipients: new Map(failedEmails.map(e => [e, "pending"])),
        sent: 0, failed: 0, total: failedEmails.length, done: false,
      },
    } : null)

    let response: Response
    try {
      response = await apiFetch(`/api/marketing/sends/${send.id}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totpCode }),
        waitForSession: true,
      })
    } catch (err) {
      toast.error(err instanceof NetworkError ? err.message : "Couldn't start the resend.")
      setDeliveryModal(prev => prev ? { ...prev, resending: false, resendProgress: null } : null)
      return
    }
    if (!response.ok || !response.body) {
      toast.error(await errorMessage(response, "Couldn't start the resend."))
      setDeliveryModal(prev => prev ? { ...prev, resending: false, resendProgress: null } : null)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === "result") {
            setDeliveryModal(prev => {
              if (!prev?.resendProgress) return prev
              const map = new Map(prev.resendProgress.recipients)
              map.set(event.email, event.status)
              return {
                ...prev,
                resendProgress: {
                  ...prev.resendProgress,
                  recipients: map,
                  sent: event.status === "sent" ? prev.resendProgress.sent + 1 : prev.resendProgress.sent,
                  failed: event.status === "failed" ? prev.resendProgress.failed + 1 : prev.resendProgress.failed,
                },
              }
            })
          } else if (event.type === "done") {
            setDeliveryModal(prev => prev ? {
              ...prev,
              resending: false,
              resendProgress: prev.resendProgress ? { ...prev.resendProgress, done: true } : null,
              // update recipients: previously failed+now sent → mark sent
              recipients: prev.recipients?.map(r =>
                r.status === "failed" && prev.resendProgress?.recipients.get(r.email) === "sent"
                  ? { ...r, status: "sent" }
                  : r
              ) ?? null,
              send: { ...prev.send, failedRecipients: prev.send.failedRecipients?.filter(e => prev.resendProgress?.recipients.get(e) !== "sent") },
            } : null)
            setSends(prev => [{
              id: event.sendId,
              newsletterId: deliveryModal.send.newsletterId,
              newsletterTitle: deliveryModal.send.newsletterTitle,
              listName: deliveryModal.send.listName,
              sendMode: "list",
              sentAt: new Date().toISOString(),
              sentBy: "you",
              recipientCount: event.sent,
              failedCount: event.failed,
              trackingEnabled: deliveryModal.send.trackingEnabled,
            }, ...prev])
          }
        } catch {}
      }
    }
  }

  // Copy subscribe link
  const [copiedList, setCopiedList] = useState<string | null>(null)

  function copySubscribeLink(listName: string) {
    const url = `${window.location.origin}/subscribe/${encodeURIComponent(listName)}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedList(listName)
      setTimeout(() => setCopiedList(null), 2000)
    })
  }

  // Delete send
  const [deleteSendTarget, setDeleteSendTarget] = useState<SendRecord | null>(null)
  const [deletingSend, setDeletingSend] = useState(false)
  const [deleteSendError, setDeleteSendError] = useState("")

  useEffect(() => {
    Promise.all([
      fetch("/api/marketing/lists").then(r => r.json()),
      fetch("/api/marketing/sends").then(r => r.json()),
      fetch("/api/newsletters?all=true").then(r => r.json()),
    ])
      .then(([listsData, sendsData, newslettersData]) => {
        if (Array.isArray(listsData)) setLists(listsData)
        else setError("Failed to load lists")
        if (Array.isArray(sendsData)) setSends(sendsData)
        if (Array.isArray(newslettersData)) setNewsletters(newslettersData)
      })
      .catch(() => setError("Failed to load data"))
      .finally(() => setLoading(false))
  }, [])

  // Re-attach the progress monitor after a reload: a ?send=<id> link wins, else the newest active send.
  useEffect(() => {
    let cancelled = false
    const linked = new URLSearchParams(window.location.search).get("send")
    if (linked) setMonitor({ sendId: linked, title: "", listName: "", live: { phase: "ended" } })
    apiFetch("/api/marketing/sends/active", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { workerEnabled: boolean; active: SendSummary[] } | null) => {
        if (cancelled || !data) return
        setWorkerEnabled(data.workerEnabled)
        const newest = data.active[0]
        if (!linked && newest) {
          setMonitor(prev => prev ?? { sendId: newest.id, title: newest.newsletterTitle, listName: newest.listName, live: { phase: "ended" } })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Keep ?send=<id> in the URL while the monitor is open, so a reload or a shared link reopens it.
  const monitorSendId = monitor?.sendId ?? null
  useEffect(() => {
    const url = new URL(window.location.href)
    if (monitorSendId) url.searchParams.set("send", monitorSendId)
    else url.searchParams.delete("send")
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href)
  }, [monitorSendId])

  function updateSendInHistory(s: SendSummary) {
    setSends(prev => {
      const i = prev.findIndex(x => x.id === s.id)
      if (i === -1) return [s as SendRecord, ...prev]
      const next = [...prev]
      // Keep the recipient lists from the full record; take counts and status from the summary.
      next[i] = { ...prev[i], ...s } as SendRecord
      return next
    })
  }

  async function createList() {
    if (!newListName.trim()) return
    setCreatingList(true)
    try {
      const res = await fetch("/api/marketing/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName.trim(), description: newListDesc.trim() || undefined }),
      })
      if (res.ok) {
        setLists(prev => [...prev, { name: newListName.trim(), description: newListDesc.trim() || undefined }])
        setNewListName("")
        setNewListDesc("")
      }
    } finally {
      setCreatingList(false)
    }
  }

  function deleteList(name: string) {
    setPendingDeleteList(name)
  }

  async function confirmDeleteList() {
    const name = pendingDeleteList
    if (!name) return
    setDeletingList(true)
    try {
      const res = await fetch(`/api/marketing/lists/${encodeURIComponent(name)}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setLists(prev => prev.filter(l => l.name !== name))
      toast.success(`Deleted "${name}"`)
      setPendingDeleteList(null)
    } catch {
      toast.error(`Couldn't delete "${name}". Try again.`)
    } finally {
      setDeletingList(false)
    }
  }

  async function openContacts(listName: string) {
    setContactsModal(listName)
    setContacts([])
    setContactsError(null)
    setNewEmail("")
    setBulkMode(false)
    setBulkText("")
    setBulkResult(null)
    setContactsLoading(true)
    try {
      const res = await fetch(`/api/marketing/lists/${encodeURIComponent(listName)}/contacts`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setContactsError(data.error ?? `Failed to load contacts (${res.status})`)
        return
      }
      const data = await res.json()
      if (Array.isArray(data)) setContacts(data)
    } finally {
      setContactsLoading(false)
    }
  }

  async function addContact() {
    if (!contactsModal || !newEmail.trim()) return
    setAddingContact(true)
    try {
      const res = await fetch(`/api/marketing/lists/${encodeURIComponent(contactsModal)}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      })
      if (res.ok) {
        setContacts(prev => [...prev, { email: newEmail.trim(), unsubscribed: false }])
        setNewEmail("")
      }
    } finally {
      setAddingContact(false)
    }
  }

  function parseBulkEmails(text: string): string[] {
    return [...new Set(
      text.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(s => s.includes("@"))
    )]
  }

  async function bulkAdd() {
    if (!contactsModal) return
    const all = parseBulkEmails(bulkText)
    if (!all.length) return
    setBulkAdding(true)
    setBulkResult(null)
    const existing = new Set(contacts.map(c => c.email.toLowerCase()))
    const toAdd = all.filter(e => !existing.has(e))
    const skipped = all.filter(e => existing.has(e))
    try {
      const res = await fetch(`/api/marketing/lists/${encodeURIComponent(contactsModal)}/contacts/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: toAdd }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const errorMsg = data.error ?? `Bulk add failed (${res.status})`
        setBulkResult({ added: [], skipped, failed: toAdd.map(email => ({ email, reason: errorMsg })) })
        return
      }
      const data = await res.json()
      const added: string[] = Array.isArray(data.added) ? data.added : []
      const failed: { email: string; reason: string }[] = Array.isArray(data.failed) ? data.failed : []
      setContacts(prev => [...prev, ...added.map(email => ({ email, unsubscribed: false }))])
      setBulkResult({ added, skipped, failed })
      if (added.length > 0) setBulkText("")
    } catch (err) {
      setBulkResult({ added: [], skipped, failed: toAdd.map(email => ({ email, reason: err instanceof Error ? err.message : "Network error" })) })
    } finally {
      setBulkAdding(false)
    }
  }

  async function removeContact(email: string) {
    if (!contactsModal) return
    await fetch(`/api/marketing/lists/${encodeURIComponent(contactsModal)}/contacts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    setContacts(prev => prev.filter(c => c.email !== email))
  }

  function requestTOTP(callback: (code: string) => void) {
    setTotpInput("")
    setTotpError("")
    setTotpPromptCallback(() => callback)
  }

  function cancelTOTP() {
    setTotpPromptCallback(null)
    setTotpInput("")
    setTotpError("")
  }

  function submitTOTP() {
    if (totpInput.length !== 6 || !totpPromptCallback) return
    const cb = totpPromptCallback
    setTotpPromptCallback(null)
    setTotpInput("")
    setTotpError("")
    cb(totpInput)
  }

  function openSendDialog(listName: string) {
    setSendDialog(listName)
    setSelectedNewsletterId("")
    setSubject("")
    setReplyTo(DEFAULT_REPLY_TO)
    setFromName(DEFAULT_FROM_NAME)
    setIncludeWebLink(true)
    setTrackingEnabled(true)
    setTestEmail("")
    setSendResult("")
    setTestResult("")
    setConfirmSend(false)
    setTestSendId(null)
  }


  function buildSendPayload(mode: "list" | "test" | "dryrun", extra: Record<string, string>) {
    return {
      mode,
      newsletterId: selectedNewsletterId,
      subject: subject.trim() || undefined,
      replyTo: replyTo.trim() || undefined,
      fromName: fromName.trim() || undefined,
      includeWebLink,
      trackingEnabled,
      ...extra,
    }
  }

  // Starts a send (list, dry run or resume) and attaches the monitor. The inline engine streams SSE until
  // it pauses or finishes; the worker answers 202 with the job id at once. Progress always comes from the
  // stored record (SendMonitor polls it), so a dropped connection or a reload never loses the send.
  async function startSend(payload: Record<string, unknown>, meta: { title: string; listName: string; sendId?: string }) {
    setMonitor({ sendId: meta.sendId ?? null, title: meta.title, listName: meta.listName, live: { phase: "starting" } })
    const setLive = (live: LiveState, sendId?: string) =>
      setMonitor(prev => prev ? { ...prev, live, sendId: sendId ?? prev.sendId } : prev)

    let response: Response
    try {
      response = await apiFetch("/api/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        waitForSession: true,
      })
    } catch (err) {
      const message = err instanceof NetworkError
        ? "Can't reach the server, so the send may not have started. Check Send history before trying again."
        : "The send didn't start."
      toast.error(message)
      setLive({ phase: meta.sendId ? "interrupted" : "error", error: message })
      return
    }

    if (!response.ok || !response.body) {
      const message = response.status === 504
        ? "The server took too long to answer. Check Send history before trying again."
        : await errorMessage(response, "The send didn't start.")
      toast.error(message)
      setLive({ phase: meta.sendId ? "ended" : "error", error: message })
      return
    }

    if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const data = await response.json().catch(() => ({})) as { sendId?: string }
      setLive({ phase: "ended" }, data.sendId)
      return
    }

    setLive({ phase: "streaming" })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let finished = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          let event: { type: string; sendId?: string; message?: string }
          try { event = JSON.parse(line.slice(6)) } catch { continue }
          if (event.type === "sendId" && event.sendId) {
            setLive({ phase: "streaming" }, event.sendId)
          } else if (event.type === "error") {
            finished = true
            setLive({ phase: "ended", error: event.message ?? "The send stopped because of a server error." })
          } else if (event.type === "done" || event.type === "paused" || event.type === "cancelled") {
            finished = true
            setLive({ phase: "ended" })
          }
        }
      }
    } catch {
      // Connection dropped (network, or the platform cut the request off)
    }
    if (!finished) setLive({ phase: "interrupted" })
  }

  async function sendToList(totpCode: string, dryRun = false) {
    if (!sendDialog || !selectedNewsletterId) return
    const listName = sendDialog
    const nl = newsletters.find(n => n.id === selectedNewsletterId)
    setConfirmSend(false)
    setSendDialog(null)
    await startSend(
      { ...buildSendPayload(dryRun ? "dryrun" : "list", { listName }), totpCode },
      { title: nl?.title ?? selectedNewsletterId, listName },
    )
  }

  function resumeSend(s: SendSummary | SendRecord) {
    requestTOTP(code => {
      void startSend(
        { mode: "resume", sendId: s.id, newsletterId: s.newsletterId, totpCode: code },
        { title: s.newsletterTitle, listName: s.listName, sendId: s.id },
      )
    })
  }

  async function cancelSend(s: SendSummary | SendRecord) {
    try {
      const res = await apiFetch(`/api/marketing/sends/${encodeURIComponent(s.id)}/cancel`, { method: "POST", waitForSession: true })
      if (!res.ok) {
        toast.error(await errorMessage(res, "Couldn't cancel the send."))
        return
      }
      toast.success("Cancelling — the send stops before its next batch.")
    } catch (err) {
      toast.error(err instanceof NetworkError ? err.message : "Couldn't cancel the send.")
    }
  }

  async function sendTest(totpCode: string) {
    if (!sendDialog || !selectedNewsletterId || !testEmail.trim()) return
    setSending(true)
    setTestResult("")
    setTestSendId(null)
    try {
      const res = await fetch("/api/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildSendPayload("test", { email: testEmail.trim() }), totpCode }),
      })
      const data = await res.json()
      if (res.ok) {
        setTestResult(`Test sent to ${testEmail.trim()}`)
        if (data.sendId && trackingEnabled) setTestSendId(data.sendId)
      } else {
        setTestResult(`Error: ${data.error ?? "Send failed"}`)
      }
    } finally {
      setSending(false)
    }
  }

  async function confirmDeleteSend() {
    if (!deleteSendTarget) return
    setDeletingSend(true)
    setDeleteSendError("")
    try {
      const res = await fetch(`/api/marketing/sends/${deleteSendTarget.id}`, { method: "DELETE" })
      if (res.ok) {
        setSends(prev => prev.filter(s => s.id !== deleteSendTarget.id))
        setDeleteSendTarget(null)
      } else {
        const data = await res.json()
        setDeleteSendError(data.error ?? "Delete failed")
      }
    } catch {
      setDeleteSendError("Network error")
    } finally {
      setDeletingSend(false)
    }
  }

  const selectedNewsletter = newsletters.find(n => n.id === selectedNewsletterId)
  const effectiveSubject = subject.trim() || selectedNewsletter?.title || ""

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="flex flex-col gap-10">

      {/* Lists section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Email Lists</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/live/manage/ses-audit")}
              className="text-xs text-fg-muted hover:text-foreground transition-colors"
            >
              SES Audit →
            </button>
            <span className="text-fg-muted text-xs">{lists.length} list{lists.length !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* New list form */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="List name"
            value={newListName}
            onChange={e => setNewListName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && createList()}
            className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder-white/30 focus:border-border-strong"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newListDesc}
            onChange={e => setNewListDesc(e.target.value)}
            className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder-white/30 focus:border-border-strong"
          />
          <button
            onClick={createList}
            disabled={creatingList || !newListName.trim()}
            className="px-4 py-2 text-sm bg-surface-2 hover:bg-surface-3 text-foreground rounded-xl transition-colors disabled:opacity-40"
          >
            {creatingList ? "Creating…" : "Create"}
          </button>
        </div>

        {lists.length === 0 ? (
          <p className="text-fg-muted text-sm">No email lists yet. Create one above.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {lists.map(list => (
              <div
                key={list.name}
                className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3"
              >
                <div>
                  <p className="font-medium text-sm">{list.name}</p>
                  {list.description && (
                    <p className="text-fg-muted text-xs mt-0.5">{list.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openContacts(list.name)}
                    className="px-3 py-1.5 text-xs text-fg-secondary hover:text-foreground bg-surface hover:bg-surface-2 rounded-md transition-colors"
                  >
                    Contacts
                  </button>
                  <button
                    onClick={() => openSendDialog(list.name)}
                    className="px-3 py-1.5 text-xs text-fg-secondary hover:text-foreground bg-surface hover:bg-surface-2 rounded-md transition-colors"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => copySubscribeLink(list.name)}
                    className="px-3 py-1.5 text-xs text-fg-secondary hover:text-foreground bg-surface hover:bg-surface-2 rounded-md transition-colors"
                  >
                    {copiedList === list.name ? "Copied!" : "Copy link"}
                  </button>
                  <button
                    onClick={() => deleteList(list.name)}
                    className="px-3 py-1.5 text-xs text-destructive/60 hover:text-destructive bg-destructive/5 hover:bg-destructive/10 rounded-md transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send history section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Send History</h2>
          <span className="text-fg-muted text-xs">{sends.length} send{sends.length !== 1 ? "s" : ""}</span>
        </div>

        {sends.length === 0 ? (
          <p className="text-fg-muted text-sm">No sends yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg-muted text-xs border-b border-border">
                  <th className="text-left pb-2 pr-4 font-medium">Newsletter</th>
                  <th className="text-left pb-2 pr-4 font-medium">List</th>
                  <th className="text-left pb-2 pr-4 font-medium">Sent</th>
                  <th className="text-left pb-2 pr-4 font-medium">By</th>
                  <th className="text-left pb-2 pr-4 font-medium">Recipients</th>
                  <th className="text-left pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sends.map(s => (
                  <tr key={s.id} className="border-b border-border hover:bg-surface-2">
                    <td className="py-2.5 pr-4 text-foreground max-w-[200px] truncate">{s.newsletterTitle}</td>
                    <td className="py-2.5 pr-4 text-fg-secondary">
                      <span>{s.listName}</span>
                      {s.sendMode === "test" && (
                        <span className="ml-1.5 text-[11px] bg-warning/10 text-warning border border-warning/30 px-1.5 py-0.5 rounded-full">test</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-fg-muted whitespace-nowrap">
                      <span title={s.sentAt}>{timeAgo(s.sentAt)}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-fg-secondary">{s.sentBy}</td>
                    <td className="py-2.5 pr-4 text-fg-secondary whitespace-nowrap">
                      <SendStatusCell s={s} onOpen={() => setMonitor({ sendId: s.id, title: s.newsletterTitle, listName: s.listName, live: { phase: "ended" } })} />
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        {s.trackingEnabled && (
                          <button
                            onClick={() => router.push(`/live/manage/sends/${s.id}`)}
                            className="text-xs text-fg-muted hover:text-foreground bg-surface hover:bg-surface-2 px-2 py-1 rounded-md transition-colors"
                          >
                            Stats
                          </button>
                        )}
                        {s.sendMode !== "test" && (
                          <button
                            onClick={() => openDelivery(s)}
                            className={`text-xs px-2 py-1 rounded-md transition-colors ${
                              (s.failedCount ?? 0) > 0
                                ? "text-destructive/70 hover:text-destructive bg-destructive/5 hover:bg-destructive/10"
                                : "text-fg-muted hover:text-foreground bg-surface hover:bg-surface-2"
                            }`}
                          >
                            {(s.failedCount ?? 0) > 0 ? `Delivery (${s.failedCount} failed)` : "Delivery"}
                          </button>
                        )}
                        <button
                          onClick={() => { setDeleteSendTarget(s); setDeleteSendError("") }}
                          className="text-xs text-destructive/50 hover:text-destructive bg-destructive/5 hover:bg-destructive/10 px-2 py-1 rounded-md transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Contacts modal */}
      {contactsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 max-w-lg w-full mx-4 flex flex-col gap-4 max-h-[80vh]">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Contacts — {contactsModal} <span className="text-fg-muted font-normal text-sm">({contacts.length})</span></h3>
              <div className="flex items-center gap-3">
                {contacts.length > 0 && (
                  <button
                    onClick={() => {
                      const csv = ["email,status", ...[...contacts]
                        .sort((a, b) => a.email.localeCompare(b.email))
                        .map(c => `${c.email},${c.unsubscribed ? "unsubscribed" : "active"}`)
                      ].join("\n")
                      const blob = new Blob([csv], { type: "text/csv" })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = `${contactsModal}-contacts.csv`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="text-xs text-fg-muted hover:text-foreground transition-colors"
                  >
                    Download CSV
                  </button>
                )}
                <button
                  onClick={() => setContactsModal(null)}
                  className="text-fg-muted hover:text-foreground text-lg leading-none transition-colors"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {contactsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="md" />
                </div>
              ) : contactsError ? (
                <p className="text-destructive text-sm">{contactsError}</p>
              ) : contacts.length === 0 ? (
                <p className="text-fg-muted text-sm">No contacts yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-fg-muted text-xs border-b border-border">
                      <th className="text-left pb-2 pr-4 font-medium">Email</th>
                      <th className="text-left pb-2 pr-4 font-medium">Status</th>
                      <th className="text-left pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...contacts].sort((a, b) => a.email.localeCompare(b.email)).map(c => (
                      <tr key={c.email} className="border-b border-border">
                        <td className="py-2.5 pr-4 text-foreground">{c.email}</td>
                        <td className="py-2.5 pr-4">
                          {c.unsubscribed ? (
                            <span className="text-xs text-destructive/70 bg-destructive/10 px-2 py-0.5 rounded-md">Unsubscribed</span>
                          ) : (
                            <span className="text-xs text-success/70 bg-success/10 px-2 py-0.5 rounded-md">Active</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <button
                            onClick={() => removeContact(c.email)}
                            className="text-xs text-destructive/60 hover:text-destructive transition-colors"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex flex-col gap-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted font-medium">Add contacts</span>
                <button
                  onClick={() => { setBulkMode(m => !m); setBulkText(""); setBulkResult(null) }}
                  className="text-xs text-fg-muted hover:text-foreground transition-colors"
                >
                  {bulkMode ? "Single" : "Bulk add"}
                </button>
              </div>

              {bulkMode ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    placeholder={"one@example.com\ntwo@example.com\nthree@example.com"}
                    value={bulkText}
                    onChange={e => { setBulkText(e.target.value); setBulkResult(null) }}
                    rows={5}
                    className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder-white/20 focus:border-border-strong resize-none font-mono"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-fg-muted">
                      {parseBulkEmails(bulkText).length > 0
                        ? `${parseBulkEmails(bulkText).length} email${parseBulkEmails(bulkText).length !== 1 ? "s" : ""} detected`
                        : "Separate by newline or comma"}
                    </span>
                    <button
                      onClick={bulkAdd}
                      disabled={bulkAdding || parseBulkEmails(bulkText).length === 0}
                      className="px-4 py-2 text-sm bg-surface-2 hover:bg-surface-3 text-foreground rounded-xl transition-colors disabled:opacity-40 shrink-0"
                    >
                      {bulkAdding ? "Adding…" : `Add ${parseBulkEmails(bulkText).length || ""}`}
                    </button>
                  </div>
                  {bulkResult && (
                    <div className="text-xs rounded-md px-3 py-2 bg-surface flex flex-col gap-2">
                      {bulkResult.added.length > 0 && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-success/80 font-medium">{bulkResult.added.length} added</span>
                          <div className="text-success/50 font-mono pl-1 flex flex-col gap-0.5">
                            {bulkResult.added.map(e => <span key={e}>{e}</span>)}
                          </div>
                        </div>
                      )}
                      {bulkResult.skipped.length > 0 && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-fg-muted font-medium">{bulkResult.skipped.length} already in list</span>
                          <div className="text-fg-faint font-mono pl-1 flex flex-col gap-0.5">
                            {bulkResult.skipped.map(e => <span key={e}>{e}</span>)}
                          </div>
                        </div>
                      )}
                      {bulkResult.failed.length > 0 && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-destructive/80 font-medium">{bulkResult.failed.length} failed</span>
                          <div className="pl-1 flex flex-col gap-1">
                            {bulkResult.failed.map(({ email, reason }) => (
                              <div key={email} className="flex flex-col gap-0.5">
                                <span className="text-destructive/70 font-mono">{email}</span>
                                <span className="text-destructive/40 pl-2 break-all">{reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="Add email address"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addContact()}
                    className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder-white/30 focus:border-border-strong"
                  />
                  <button
                    onClick={addContact}
                    disabled={addingContact || !newEmail.trim()}
                    className="px-4 py-2 text-sm bg-surface-2 hover:bg-surface-3 text-foreground rounded-xl transition-colors disabled:opacity-40"
                  >
                    {addingContact ? "Adding…" : "Add"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Send dialog */}
      {sendDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Send to {sendDialog}</h3>
              <button
                onClick={() => setSendDialog(null)}
                className="text-fg-muted hover:text-foreground text-lg leading-none transition-colors"
              >
                ×
              </button>
            </div>

            {/* Newsletter picker */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-fg-muted font-medium">Newsletter</label>
              <select
                value={selectedNewsletterId}
                onChange={e => {
                  setSelectedNewsletterId(e.target.value)
                  setSubject("")
                }}
                className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-border-strong"
              >
                <option value="">Select a newsletter…</option>
                {newsletters.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.title}{!n.published ? " (Draft)" : ""}
                  </option>
                ))}
              </select>
              {selectedNewsletter && !selectedNewsletter.published && (
                <p className="text-xs text-warning/70 bg-warning/10 rounded-md px-2 py-1">
                  This newsletter is unpublished — recipients will still receive it.
                </p>
              )}
            </div>

            {/* Subject line */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-fg-muted font-medium">Subject line</label>
              <input
                type="text"
                placeholder={selectedNewsletter?.title ?? "Defaults to newsletter title"}
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder-white/30 focus:border-border-strong"
              />
            </div>

            {/* From name + Reply-to row */}
            <div className="flex gap-3">
              <div className="flex flex-col gap-2 flex-1">
                <label className="text-xs text-fg-muted font-medium">From name</label>
                <input
                  type="text"
                  value={fromName}
                  onChange={e => setFromName(e.target.value)}
                  placeholder="Void Ultimate"
                  className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder-white/30 focus:border-border-strong"
                />
              </div>
              <div className="flex flex-col gap-2 flex-1">
                <label className="text-xs text-fg-muted font-medium">Reply-to</label>
                <input
                  type="email"
                  value={replyTo}
                  onChange={e => setReplyTo(e.target.value)}
                  className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder-white/30 focus:border-border-strong"
                />
              </div>
            </div>

            {/* Web link + tracking checkboxes */}
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWebLink}
                  onChange={e => setIncludeWebLink(e.target.checked)}
                  className="accent-white w-3.5 h-3.5"
                />
                <span className="text-sm text-fg-secondary">Include "view on web" link</span>
              </label>
              {includeWebLink && selectedNewsletter && !selectedNewsletter.published && (
                <p className="text-xs text-warning/70 bg-warning/10 rounded-md px-2 py-1">
                  Warning: this newsletter is unpublished — the web link will return a 404.
                </p>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trackingEnabled}
                  onChange={e => setTrackingEnabled(e.target.checked)}
                  className="accent-white w-3.5 h-3.5"
                />
                <span className="text-sm text-fg-secondary">Enable open &amp; click tracking</span>
              </label>
            </div>

            {/* Test send */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
              <label className="text-xs text-fg-muted font-medium">Test send</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder-white/30 focus:border-border-strong"
                />
                <button
                  onClick={() => requestTOTP(sendTest)}
                  disabled={sending || !selectedNewsletterId || !testEmail.trim()}
                  className="px-3 py-2 text-xs bg-surface-2 hover:bg-surface-3 text-foreground rounded-md transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  Send test
                </button>
              </div>
              {testResult && (
                <div className="flex items-center gap-3">
                  <p className={`text-xs ${testResult.startsWith("Error") ? "text-destructive" : "text-success/80"}`}>
                    {testResult}
                  </p>
                  {testSendId && (
                    <button
                      onClick={() => router.push(`/live/manage/sends/${testSendId}`)}
                      className="text-xs text-fg-muted hover:text-foreground underline transition-colors"
                    >
                      View stats →
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Send to list */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setConfirmSend(true)}
                disabled={sending || !selectedNewsletterId}
                className="w-full py-2.5 text-sm bg-foreground text-background font-medium rounded-xl hover:bg-foreground/90 transition-colors disabled:opacity-40"
              >
                Send to list
              </button>
              {sendResult && (
                <p className={`text-xs text-center ${sendResult.startsWith("Error") ? "text-destructive" : "text-success/80"}`}>
                  {sendResult}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delivery modal */}
      {deliveryModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 flex flex-col overflow-hidden max-h-[80vh]">
            {/* Header */}
            <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-sm">{deliveryModal.send.newsletterTitle}</p>
                <p className="text-fg-muted text-xs mt-0.5">
                  {(() => {
                    const c = sendCounts(deliveryModal.send as SendLike)
                    return c.total > c.sent ? `${deliveryModal.send.listName} · ${c.sent} of ${c.total} sent` : `${deliveryModal.send.listName} · ${c.sent} sent`
                  })()}
                </p>
              </div>
              <button onClick={() => setDeliveryModal(null)} aria-label="Close" className="text-fg-muted hover:text-foreground text-lg leading-none transition-colors shrink-0">×</button>
            </div>

            {/* What this send recorded (old sends stored only failures) */}
            {(deliveryModal.source === "none" || canResume(deliveryModal.send as SendLike) || deliveryModal.error) && (
              <div className="px-5 py-3 border-b border-border flex flex-col gap-2 text-xs">
                {deliveryModal.error && <p className="text-destructive">{deliveryModal.error}</p>}
                {deliveryModal.source === "none" && (
                  <p className="text-fg-muted">
                    This send is from before per-recipient tracking, so only failures were recorded. It reported{" "}
                    {deliveryModal.send.recipientCount} sent; who exactly received it is unknown.
                  </p>
                )}
                {canResume(deliveryModal.send as SendLike) && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-warning">
                      Stopped partway — {sendCounts(deliveryModal.send as SendLike).notSent} not sent yet.
                    </p>
                    <Button size="xs" onClick={() => { const s = deliveryModal.send; setDeliveryModal(null); resumeSend(s) }}>
                      Resume
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Summary bar */}
            {deliveryModal.recipients && (() => {
              const failed = deliveryModal.recipients.filter(r => r.status === "failed")
              const sent = deliveryModal.recipients.filter(r => r.status === "sent" || r.status === "dryrun")
              const unknown = deliveryModal.recipients.filter(r => r.status === "unknown")
              // Resend-failed reads the record's failure list; worker sends keep failures per recipient instead.
              const canResendFailed = deliveryModal.send.engine !== "worker"
              return (
                <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 text-xs">
                    {deliveryModal.source !== "none" && (
                      <span className="text-success">{sent.length} {deliveryModal.send.sendMode === "dryrun" ? "would be sent" : "sent"}</span>
                    )}
                    {failed.length > 0 && <span className="text-destructive">{failed.length} failed</span>}
                    {unknown.length > 0 && <span className="text-warning">{unknown.length} unconfirmed</span>}
                  </div>
                  {canResendFailed && failed.length > 0 && !deliveryModal.resending && !deliveryModal.resendProgress?.done && (
                    <button
                      onClick={() => requestTOTP(resendFailed)}
                      className="text-xs bg-surface-2 hover:bg-surface-3 text-foreground px-3 py-1.5 rounded-md transition-colors"
                    >
                      Resend to {failed.length} failed
                    </button>
                  )}
                  {deliveryModal.resendProgress?.done && (
                    <span className="text-xs text-success/70">Resend complete</span>
                  )}
                </div>
              )
            })()}

            {/* Resend progress bar */}
            {deliveryModal.resendProgress && (
              <div className="px-5 py-2 border-b border-border flex flex-col gap-1.5">
                <div className="w-full h-1 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-foreground/40 rounded-full transition-all duration-200"
                    style={{ width: `${deliveryModal.resendProgress.total > 0 ? ((deliveryModal.resendProgress.sent + deliveryModal.resendProgress.failed) / deliveryModal.resendProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-fg-muted">
                  <span>{deliveryModal.resendProgress.done ? "Done" : "Resending…"}</span>
                  <span>
                    <span className="text-success/50">{deliveryModal.resendProgress.sent} sent</span>
                    {deliveryModal.resendProgress.failed > 0 && <span className="text-destructive/50 ml-2">{deliveryModal.resendProgress.failed} failed</span>}
                  </span>
                </div>
              </div>
            )}

            {/* Recipient list */}
            <div className="overflow-y-auto flex-1">
              {deliveryModal.loading ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner size="md" />
                </div>
              ) : !deliveryModal.recipients ? (
                <p className="text-fg-muted text-sm px-5 py-6">Delivery details aren&apos;t available.</p>
              ) : deliveryModal.recipients.length === 0 ? (
                <p className="text-fg-muted text-sm px-5 py-6">
                  {deliveryModal.source === "none" ? "No failures were recorded." : "No recipients were recorded for this send."}
                </p>
              ) : (
                deliveryModal.recipients.map(r => {
                  const resendStatus = deliveryModal.resendProgress?.recipients.get(r.email)
                  return (
                    <div key={r.email} className="flex items-center justify-between px-5 py-2 border-b border-border last:border-0">
                      <span className="text-xs text-fg-secondary font-mono">{r.email}</span>
                      <div className="flex items-center gap-2">
                        {resendStatus && resendStatus !== "pending" && (
                          <span className={`text-[11px] ${resendStatus === "sent" ? "text-success/60" : "text-destructive/60"}`}>
                            {resendStatus === "sent" ? "resent ✓" : "resend failed ✗"}
                          </span>
                        )}
                        {resendStatus === "pending" && (
                          <span className="text-[11px] text-fg-faint">resending…</span>
                        )}
                        <span className={`text-[11px] font-medium ${
                          r.status === "sent" || r.status === "dryrun" ? "text-success"
                          : r.status === "failed" ? "text-destructive"
                          : r.status === "unknown" ? "text-warning"
                          : "text-fg-muted"
                        }`}>
                          {{ sent: "Sent", failed: "Failed", unknown: "Unconfirmed", pending: "Not sent yet", dryrun: "Would send" }[r.status]}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Send progress monitor */}
      {monitor && (
        <SendMonitor
          sendId={monitor.sendId}
          title={monitor.title}
          listName={monitor.listName}
          live={monitor.live}
          onClose={() => setMonitor(null)}
          onResume={resumeSend}
          onCancel={cancelSend}
          onRecord={updateSendInHistory}
          onViewStats={id => { setMonitor(null); router.push(`/live/manage/sends/${id}`) }}
        />
      )}

      {/* Delete send confirmation dialog */}
      {deleteSendTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <h3 className="font-semibold text-destructive">Delete send?</h3>
            <div className="text-sm text-fg-secondary flex flex-col gap-1">
              <p><span className="text-fg-muted">Newsletter:</span> {deleteSendTarget.newsletterTitle}</p>
              <p><span className="text-fg-muted">List:</span> {deleteSendTarget.listName}</p>
              <p><span className="text-fg-muted">Recipients:</span> {deleteSendTarget.recipientCount}</p>
            </div>
            <p className="text-xs text-destructive/70 bg-destructive/10 rounded-md px-3 py-2">
              This will permanently delete the send record and all associated tracking events. This cannot be undone.
            </p>
            {deleteSendError && <p className="text-destructive text-xs">{deleteSendError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteSendTarget(null)}
                disabled={deletingSend}
                className="px-4 py-2 text-sm text-fg-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteSend}
                disabled={deletingSend}
                className="px-4 py-2 text-sm bg-destructive/80 hover:bg-red-500 text-foreground font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                {deletingSend ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOTP prompt */}
      {totpPromptCallback && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80">
          <div className="bg-card border border-border rounded-xl p-6 max-w-xs w-full mx-4 flex flex-col gap-5">
            <div>
              <h3 className="font-semibold">Verify identity</h3>
              <p className="text-xs text-fg-muted mt-1">Enter your 6-digit authenticator code to proceed.</p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              value={totpInput}
              onChange={e => { setTotpInput(e.target.value.replace(/\D/g, "").slice(0, 6)); setTotpError("") }}
              onKeyDown={e => e.key === "Enter" && totpInput.length === 6 && submitTOTP()}
              placeholder="000000"
              className="bg-surface border border-border rounded-xl px-4 py-3 text-center text-2xl tracking-[0.4em] font-mono text-foreground placeholder-white/20 focus:border-border-strong w-full"
            />
            {totpError && <p className="text-destructive text-xs">{totpError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={cancelTOTP} className="px-4 py-2 text-sm text-fg-muted hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                onClick={submitTOTP}
                disabled={totpInput.length !== 6}
                className="px-4 py-2 text-sm bg-foreground text-background font-medium rounded-xl hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm send dialog */}
      {confirmSend && sendDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <h3 className="font-semibold">Confirm send</h3>
            <div className="text-sm text-fg-secondary flex flex-col gap-1">
              <p><span className="text-fg-muted">Newsletter:</span> {selectedNewsletter?.title ?? selectedNewsletterId}{selectedNewsletter && !selectedNewsletter.published ? " (Draft)" : ""}</p>
              <p><span className="text-fg-muted">Subject:</span> {effectiveSubject}</p>
              <p><span className="text-fg-muted">List:</span> {sendDialog}</p>
              <p><span className="text-fg-muted">From:</span> {fromName || "—"}</p>
              <p><span className="text-fg-muted">Reply-to:</span> {replyTo || "—"}</p>
            </div>
            <p className="text-xs text-fg-muted">This will send to all active subscribers on the list. This cannot be undone.</p>
            {workerEnabled && (
              <p className="text-xs text-fg-muted">A dry run walks the list and shows who would get it, without sending any email.</p>
            )}
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                onClick={() => setConfirmSend(false)}
                className="px-4 py-2 text-sm text-fg-muted hover:text-foreground transition-colors"
                disabled={sending}
              >
                Cancel
              </button>
              {workerEnabled && (
                <Button variant="outline" onClick={() => requestTOTP(code => void sendToList(code, true))} disabled={sending}>
                  Dry run
                </Button>
              )}
              <button
                onClick={() => requestTOTP(code => void sendToList(code))}
                disabled={sending}
                className="px-4 py-2 text-sm bg-foreground text-background font-medium rounded-xl hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={pendingDeleteList !== null}
        onOpenChange={open => { if (!open && !deletingList) setPendingDeleteList(null) }}
        title="Delete contact list?"
        description={`"${pendingDeleteList ?? ""}" and its contacts will be deleted. This can't be undone.`}
        confirmLabel="Delete list"
        isLoading={deletingList}
        onConfirm={confirmDeleteList}
      />
    </div>
  )
}
