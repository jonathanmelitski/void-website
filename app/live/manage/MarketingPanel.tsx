"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { SendRecord } from "@/lib/aws/sends"
import type { NewsletterItem } from "@/lib/aws/newsletters"

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

  // Contacts modal
  const [contactsModal, setContactsModal] = useState<string | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [addingContact, setAddingContact] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState("")
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number; failed: string[] } | null>(null)

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

  // Send progress
  type RecipientStatus = "pending" | "sent" | "failed"
  const [sendProgress, setSendProgress] = useState<{
    listName: string
    newsletterTitle: string
    recipients: { email: string; status: RecipientStatus }[]
    sent: number
    failed: number
    total: number
    done: boolean
    sendId: string | null
    trackingEnabled: boolean
  } | null>(null)
  // Delivery modal
  type DeliveryRecipient = { email: string; status: "sent" | "failed" }
  const [deliveryModal, setDeliveryModal] = useState<{
    send: SendRecord
    recipients: DeliveryRecipient[] | null
    loading: boolean
    resending: boolean
    resendProgress: { recipients: Map<string, "pending" | "sent" | "failed">; sent: number; failed: number; total: number; done: boolean } | null
  } | null>(null)

  async function openDelivery(s: SendRecord) {
    setDeliveryModal({ send: s, recipients: null, loading: true, resending: false, resendProgress: null })
    try {
      const res = await fetch(`/api/marketing/lists/${encodeURIComponent(s.listName)}/contacts`)
      const data = await res.json()
      if (Array.isArray(data)) {
        const failedSet = new Set(s.failedRecipients ?? [])
        const recipients: DeliveryRecipient[] = data
          .filter((c: { unsubscribed: boolean }) => !c.unsubscribed)
          .map((c: { email: string }) => ({
            email: c.email,
            status: (failedSet.has(c.email) ? "failed" : "sent") as "sent" | "failed",
          }))
          .sort((a: DeliveryRecipient, b: DeliveryRecipient) => {
            if (a.status === b.status) return a.email.localeCompare(b.email)
            return a.status === "failed" ? -1 : 1
          })
        setDeliveryModal(prev => prev ? { ...prev, recipients, loading: false } : null)
      }
    } catch {
      setDeliveryModal(prev => prev ? { ...prev, loading: false } : null)
    }
  }

  async function resendFailed() {
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

    const response = await fetch(`/api/marketing/sends/${send.id}/resend`, { method: "POST" })
    if (!response.ok || !response.body) {
      setDeliveryModal(prev => prev ? { ...prev, resending: false } : null)
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

  async function deleteList(name: string) {
    if (!confirm(`Delete list "${name}"? This cannot be undone.`)) return
    await fetch(`/api/marketing/lists/${encodeURIComponent(name)}`, { method: "DELETE" })
    setLists(prev => prev.filter(l => l.name !== name))
  }

  async function openContacts(listName: string) {
    setContactsModal(listName)
    setContacts([])
    setNewEmail("")
    setBulkMode(false)
    setBulkText("")
    setBulkResult(null)
    setContactsLoading(true)
    try {
      const res = await fetch(`/api/marketing/lists/${encodeURIComponent(listName)}/contacts`)
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
    const skipped = all.length - toAdd.length
    try {
      const res = await fetch(`/api/marketing/lists/${encodeURIComponent(contactsModal)}/contacts/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: toAdd }),
      })
      const data = await res.json()
      const addedCount: number = data.added ?? 0
      const failedCount: number = data.failed ?? 0
      setContacts(prev => [...prev, ...toAdd.map(email => ({ email, unsubscribed: false }))])
      setBulkResult({ added: addedCount, skipped, failed: failedCount > 0 ? [`${failedCount} email(s) rejected by SES`] : [] })
      if (addedCount > 0) setBulkText("")
    } catch {
      setBulkResult({ added: 0, skipped, failed: toAdd })
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


  function buildSendPayload(mode: "list" | "test", extra: Record<string, string>) {
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

  async function sendToList() {
    if (!sendDialog || !selectedNewsletterId) return
    const listName = sendDialog
    const nl = newsletters.find(n => n.id === selectedNewsletterId)
    setConfirmSend(false)
    setSendDialog(null)

    // Show a preparing state immediately — before contacts are fetched
    setSendProgress({
      listName,
      newsletterTitle: nl?.title ?? selectedNewsletterId,
      recipients: [],
      sent: 0,
      failed: 0,
      total: 0,
      done: false,
      sendId: null,
      trackingEnabled,
    })

    // Fetch contacts to pre-populate the recipient list
    const contactsRes = await fetch(`/api/marketing/lists/${encodeURIComponent(listName)}/contacts`)
    const contactsData = await contactsRes.json()
    const activeEmails: string[] = Array.isArray(contactsData)
      ? contactsData.filter((c: { email: string; unsubscribed: boolean }) => !c.unsubscribed).map((c: { email: string }) => c.email)
      : []

    setSendProgress(prev => prev ? {
      ...prev,
      recipients: activeEmails.map(email => ({ email, status: "pending" })),
      total: activeEmails.length,
    } : null)

    const response = await fetch("/api/marketing/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSendPayload("list", { listName })),
    })

    if (!response.ok || !response.body) {
      setSendProgress(prev => prev ? { ...prev, done: true } : null)
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

          if (event.type === "sendId") {
            // Record exists in DB now — add a placeholder to send history immediately
            setSendProgress(prev => prev ? { ...prev, sendId: event.sendId } : null)
            setSends(prev => [{
              id: event.sendId,
              newsletterId: selectedNewsletterId,
              newsletterTitle: nl?.title ?? selectedNewsletterId,
              listName,
              sendMode: "list",
              sentAt: new Date().toISOString(),
              sentBy: "you",
              recipientCount: 0,
              trackingEnabled,
            }, ...prev])
          } else if (event.type === "start") {
            setSendProgress(prev => prev ? { ...prev, total: event.total } : null)
          } else if (event.type === "result") {
            setSendProgress(prev => {
              if (!prev) return null
              const recipients = prev.recipients.map(r =>
                r.email === event.email ? { ...r, status: event.status as RecipientStatus } : r
              )
              return {
                ...prev,
                recipients,
                sent: event.status === "sent" ? prev.sent + 1 : prev.sent,
                failed: event.status === "failed" ? prev.failed + 1 : prev.failed,
              }
            })
          } else if (event.type === "done") {
            setSendProgress(prev => prev ? { ...prev, done: true, sendId: event.sendId } : null)
            // Update the placeholder in send history with final counts
            setSends(prev => prev.map(s => s.id === event.sendId
              ? { ...s, recipientCount: event.sent, failedCount: event.failed }
              : s
            ))
          }
        } catch {}
      }
    }
  }

  async function sendTest() {
    if (!sendDialog || !selectedNewsletterId || !testEmail.trim()) return
    setSending(true)
    setTestResult("")
    setTestSendId(null)
    try {
      const res = await fetch("/api/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSendPayload("test", { email: testEmail.trim() })),
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
        <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) return <p className="text-red-400 text-sm">{error}</p>

  return (
    <div className="flex flex-col gap-10">

      {/* Lists section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Email Lists</h2>
          <span className="text-white/40 text-xs">{lists.length} list{lists.length !== 1 ? "s" : ""}</span>
        </div>

        {/* New list form */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="List name"
            value={newListName}
            onChange={e => setNewListName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && createList()}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newListDesc}
            onChange={e => setNewListDesc(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
          />
          <button
            onClick={createList}
            disabled={creatingList || !newListName.trim()}
            className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-40"
          >
            {creatingList ? "Creating…" : "Create"}
          </button>
        </div>

        {lists.length === 0 ? (
          <p className="text-white/40 text-sm">No email lists yet. Create one above.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {lists.map(list => (
              <div
                key={list.name}
                className="flex items-center justify-between bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3"
              >
                <div>
                  <p className="font-medium text-sm">{list.name}</p>
                  {list.description && (
                    <p className="text-white/40 text-xs mt-0.5">{list.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openContacts(list.name)}
                    className="px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    Contacts
                  </button>
                  <button
                    onClick={() => openSendDialog(list.name)}
                    className="px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => copySubscribeLink(list.name)}
                    className="px-3 py-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    {copiedList === list.name ? "Copied!" : "Copy link"}
                  </button>
                  <button
                    onClick={() => deleteList(list.name)}
                    className="px-3 py-1.5 text-xs text-red-400/60 hover:text-red-400 bg-red-400/5 hover:bg-red-400/10 rounded-lg transition-colors"
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
          <span className="text-white/40 text-xs">{sends.length} send{sends.length !== 1 ? "s" : ""}</span>
        </div>

        {sends.length === 0 ? (
          <p className="text-white/40 text-sm">No sends yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white/30 text-xs border-b border-white/10">
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
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-4 text-white/80 max-w-[200px] truncate">{s.newsletterTitle}</td>
                    <td className="py-2.5 pr-4 text-white/60">
                      <span>{s.listName}</span>
                      {s.sendMode === "test" && (
                        <span className="ml-1.5 text-[10px] bg-yellow-400/10 text-yellow-400 border border-yellow-400/30 px-1.5 py-0.5 rounded-full">test</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-white/40 whitespace-nowrap">
                      <span title={s.sentAt}>{timeAgo(s.sentAt)}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-white/60">{s.sentBy}</td>
                    <td className="py-2.5 pr-4 text-white/60">{s.recipientCount}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        {s.trackingEnabled && (
                          <button
                            onClick={() => router.push(`/live/manage/sends/${s.id}`)}
                            className="text-xs text-white/50 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-1 rounded transition-colors"
                          >
                            Stats
                          </button>
                        )}
                        {s.sendMode !== "test" && (
                          <button
                            onClick={() => openDelivery(s)}
                            className={`text-xs px-2 py-1 rounded transition-colors ${
                              (s.failedCount ?? 0) > 0
                                ? "text-red-400/70 hover:text-red-400 bg-red-400/5 hover:bg-red-400/10"
                                : "text-white/50 hover:text-white bg-white/5 hover:bg-white/10"
                            }`}
                          >
                            {(s.failedCount ?? 0) > 0 ? `Delivery (${s.failedCount} failed)` : "Delivery"}
                          </button>
                        )}
                        <button
                          onClick={() => { setDeleteSendTarget(s); setDeleteSendError("") }}
                          className="text-xs text-red-400/50 hover:text-red-400 bg-red-400/5 hover:bg-red-400/10 px-2 py-1 rounded transition-colors"
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
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-lg w-full mx-4 flex flex-col gap-4 max-h-[80vh]">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Contacts — {contactsModal} <span className="text-white/30 font-normal text-sm">({contacts.length})</span></h3>
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
                    className="text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Download CSV
                  </button>
                )}
                <button
                  onClick={() => setContactsModal(null)}
                  className="text-white/40 hover:text-white text-lg leading-none transition-colors"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {contactsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              ) : contacts.length === 0 ? (
                <p className="text-white/40 text-sm">No contacts yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-white/30 text-xs border-b border-white/10">
                      <th className="text-left pb-2 pr-4 font-medium">Email</th>
                      <th className="text-left pb-2 pr-4 font-medium">Status</th>
                      <th className="text-left pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...contacts].sort((a, b) => a.email.localeCompare(b.email)).map(c => (
                      <tr key={c.email} className="border-b border-white/5">
                        <td className="py-2.5 pr-4 text-white/80">{c.email}</td>
                        <td className="py-2.5 pr-4">
                          {c.unsubscribed ? (
                            <span className="text-xs text-red-400/70 bg-red-400/10 px-2 py-0.5 rounded">Unsubscribed</span>
                          ) : (
                            <span className="text-xs text-green-400/70 bg-green-400/10 px-2 py-0.5 rounded">Active</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <button
                            onClick={() => removeContact(c.email)}
                            className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
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

            <div className="flex flex-col gap-3 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40 font-medium">Add contacts</span>
                <button
                  onClick={() => { setBulkMode(m => !m); setBulkText(""); setBulkResult(null) }}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors"
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
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/30 resize-none font-mono"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-white/30">
                      {parseBulkEmails(bulkText).length > 0
                        ? `${parseBulkEmails(bulkText).length} email${parseBulkEmails(bulkText).length !== 1 ? "s" : ""} detected`
                        : "Separate by newline or comma"}
                    </span>
                    <button
                      onClick={bulkAdd}
                      disabled={bulkAdding || parseBulkEmails(bulkText).length === 0}
                      className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-40 shrink-0"
                    >
                      {bulkAdding ? "Adding…" : `Add ${parseBulkEmails(bulkText).length || ""}`}
                    </button>
                  </div>
                  {bulkResult && (
                    <div className="text-xs rounded-lg px-3 py-2 bg-white/5 flex flex-col gap-1">
                      {bulkResult.added > 0 && <span className="text-green-400/80">{bulkResult.added} added</span>}
                      {bulkResult.skipped > 0 && <span className="text-white/40">{bulkResult.skipped} already in list</span>}
                      {bulkResult.failed.length > 0 && (
                        <span className="text-red-400/80">{bulkResult.failed.length} failed: {bulkResult.failed.join(", ")}</span>
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
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
                  />
                  <button
                    onClick={addContact}
                    disabled={addingContact || !newEmail.trim()}
                    className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-40"
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
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Send to {sendDialog}</h3>
              <button
                onClick={() => setSendDialog(null)}
                className="text-white/40 hover:text-white text-lg leading-none transition-colors"
              >
                ×
              </button>
            </div>

            {/* Newsletter picker */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-white/40 font-medium">Newsletter</label>
              <select
                value={selectedNewsletterId}
                onChange={e => {
                  setSelectedNewsletterId(e.target.value)
                  setSubject("")
                }}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
              >
                <option value="">Select a newsletter…</option>
                {newsletters.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.title}{!n.published ? " (Draft)" : ""}
                  </option>
                ))}
              </select>
              {selectedNewsletter && !selectedNewsletter.published && (
                <p className="text-xs text-yellow-400/70 bg-yellow-400/10 rounded px-2 py-1">
                  This newsletter is unpublished — recipients will still receive it.
                </p>
              )}
            </div>

            {/* Subject line */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-white/40 font-medium">Subject line</label>
              <input
                type="text"
                placeholder={selectedNewsletter?.title ?? "Defaults to newsletter title"}
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
              />
            </div>

            {/* From name + Reply-to row */}
            <div className="flex gap-3">
              <div className="flex flex-col gap-2 flex-1">
                <label className="text-xs text-white/40 font-medium">From name</label>
                <input
                  type="text"
                  value={fromName}
                  onChange={e => setFromName(e.target.value)}
                  placeholder="Void Ultimate"
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
                />
              </div>
              <div className="flex flex-col gap-2 flex-1">
                <label className="text-xs text-white/40 font-medium">Reply-to</label>
                <input
                  type="email"
                  value={replyTo}
                  onChange={e => setReplyTo(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
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
                <span className="text-sm text-white/70">Include "view on web" link</span>
              </label>
              {includeWebLink && selectedNewsletter && !selectedNewsletter.published && (
                <p className="text-xs text-yellow-400/70 bg-yellow-400/10 rounded px-2 py-1">
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
                <span className="text-sm text-white/70">Enable open &amp; click tracking</span>
              </label>
            </div>

            {/* Test send */}
            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <label className="text-xs text-white/40 font-medium">Test send</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30"
                />
                <button
                  onClick={sendTest}
                  disabled={sending || !selectedNewsletterId || !testEmail.trim()}
                  className="px-3 py-2 text-xs bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  Send test
                </button>
              </div>
              {testResult && (
                <div className="flex items-center gap-3">
                  <p className={`text-xs ${testResult.startsWith("Error") ? "text-red-400" : "text-green-400/80"}`}>
                    {testResult}
                  </p>
                  {testSendId && (
                    <button
                      onClick={() => router.push(`/live/manage/sends/${testSendId}`)}
                      className="text-xs text-white/40 hover:text-white underline transition-colors"
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
                className="w-full py-2.5 text-sm bg-white text-black font-medium rounded-lg hover:bg-white/90 transition-colors disabled:opacity-40"
              >
                Send to list
              </button>
              {sendResult && (
                <p className={`text-xs text-center ${sendResult.startsWith("Error") ? "text-red-400" : "text-green-400/80"}`}>
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
          <div className="bg-[#111] border border-white/10 rounded-xl w-full max-w-lg mx-4 flex flex-col overflow-hidden max-h-[80vh]">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/10 flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-sm">{deliveryModal.send.newsletterTitle}</p>
                <p className="text-white/40 text-xs mt-0.5">{deliveryModal.send.listName} · {deliveryModal.send.recipientCount} sent</p>
              </div>
              <button onClick={() => setDeliveryModal(null)} className="text-white/40 hover:text-white text-lg leading-none transition-colors shrink-0">×</button>
            </div>

            {/* Summary bar */}
            {deliveryModal.recipients && (() => {
              const failed = deliveryModal.recipients.filter(r => r.status === "failed")
              const sent = deliveryModal.recipients.filter(r => r.status === "sent")
              return (
                <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-green-400/70">{sent.length} delivered</span>
                    {failed.length > 0 && <span className="text-red-400/70">{failed.length} failed</span>}
                  </div>
                  {failed.length > 0 && !deliveryModal.resending && !deliveryModal.resendProgress?.done && (
                    <button
                      onClick={resendFailed}
                      className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Resend to {failed.length} failed
                    </button>
                  )}
                  {deliveryModal.resendProgress?.done && (
                    <span className="text-xs text-green-400/70">Resend complete</span>
                  )}
                </div>
              )
            })()}

            {/* Resend progress bar */}
            {deliveryModal.resendProgress && (
              <div className="px-5 py-2 border-b border-white/10 flex flex-col gap-1.5">
                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/40 rounded-full transition-all duration-200"
                    style={{ width: `${deliveryModal.resendProgress.total > 0 ? ((deliveryModal.resendProgress.sent + deliveryModal.resendProgress.failed) / deliveryModal.resendProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-white/30">
                  <span>{deliveryModal.resendProgress.done ? "Done" : "Resending…"}</span>
                  <span>
                    <span className="text-green-400/50">{deliveryModal.resendProgress.sent} sent</span>
                    {deliveryModal.resendProgress.failed > 0 && <span className="text-red-400/50 ml-2">{deliveryModal.resendProgress.failed} failed</span>}
                  </span>
                </div>
              </div>
            )}

            {/* Recipient list */}
            <div className="overflow-y-auto flex-1">
              {deliveryModal.loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              ) : !deliveryModal.recipients ? (
                <p className="text-white/30 text-sm px-5 py-6">Could not load recipient data.</p>
              ) : deliveryModal.recipients.length === 0 ? (
                <p className="text-white/30 text-sm px-5 py-6">No recipients found.</p>
              ) : (
                deliveryModal.recipients.map(r => {
                  const resendStatus = deliveryModal.resendProgress?.recipients.get(r.email)
                  return (
                    <div key={r.email} className="flex items-center justify-between px-5 py-2 border-b border-white/5 last:border-0">
                      <span className="text-xs text-white/60 font-mono">{r.email}</span>
                      <div className="flex items-center gap-2">
                        {resendStatus && resendStatus !== "pending" && (
                          <span className={`text-[10px] ${resendStatus === "sent" ? "text-green-400/60" : "text-red-400/60"}`}>
                            {resendStatus === "sent" ? "resent ✓" : "resend failed ✗"}
                          </span>
                        )}
                        {resendStatus === "pending" && (
                          <span className="text-[10px] text-white/20">resending…</span>
                        )}
                        <span className={`text-[10px] font-medium ${r.status === "sent" ? "text-green-400/50" : "text-red-400/70"}`}>
                          {r.status === "sent" ? "✓" : "✗ failed"}
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

      {/* Send progress modal */}
      {sendProgress && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80">
          <div className="bg-[#111] border border-white/10 rounded-xl w-full max-w-lg mx-4 flex flex-col overflow-hidden max-h-[80vh]">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/10 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{sendProgress.newsletterTitle}</p>
                  <p className="text-white/40 text-xs mt-0.5">→ {sendProgress.listName}</p>
                </div>
                {sendProgress.done ? (
                  <div className="flex items-center gap-2">
                    {sendProgress.sendId && sendProgress.trackingEnabled && (
                      <button
                        onClick={() => { router.push(`/live/manage/sends/${sendProgress.sendId}`); setSendProgress(null) }}
                        className="text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        View stats →
                      </button>
                    )}
                    <button
                      onClick={() => setSendProgress(null)}
                      className="text-xs text-white/50 hover:text-white transition-colors px-2"
                    >
                      Close
                    </button>
                  </div>
                ) : (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                )}
              </div>
              {/* Progress bar */}
              <div className="flex flex-col gap-1">
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/50 rounded-full transition-all duration-200"
                    style={{ width: `${sendProgress.total > 0 ? ((sendProgress.sent + sendProgress.failed) / sendProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-white/30">
                  <span>
                    {sendProgress.done ? "Done" : sendProgress.total === 0 ? "Preparing…" : "Sending…"} {sendProgress.total > 0 ? `${sendProgress.sent + sendProgress.failed}/${sendProgress.total}` : ""}
                  </span>
                  <span>
                    {sendProgress.sent > 0 && <span className="text-green-400/60">{sendProgress.sent} sent</span>}
                    {sendProgress.failed > 0 && <span className="text-red-400/60 ml-2">{sendProgress.failed} failed</span>}
                  </span>
                </div>
              </div>
            </div>

            {/* Recipient list */}
            <div className="overflow-y-auto flex-1">
              {sendProgress.recipients.map(r => (
                <div
                  key={r.email}
                  className="flex items-center justify-between px-5 py-2 border-b border-white/5 last:border-0"
                >
                  <span className="text-xs text-white/60 font-mono">{r.email}</span>
                  <span className={`text-[10px] font-medium ${
                    r.status === "sent" ? "text-green-400/70" :
                    r.status === "failed" ? "text-red-400/70" :
                    "text-white/20"
                  }`}>
                    {r.status === "sent" ? "✓ sent" : r.status === "failed" ? "✗ failed" : "·"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete send confirmation dialog */}
      {deleteSendTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <h3 className="font-semibold text-red-400">Delete send?</h3>
            <div className="text-sm text-white/60 flex flex-col gap-1">
              <p><span className="text-white/30">Newsletter:</span> {deleteSendTarget.newsletterTitle}</p>
              <p><span className="text-white/30">List:</span> {deleteSendTarget.listName}</p>
              <p><span className="text-white/30">Recipients:</span> {deleteSendTarget.recipientCount}</p>
            </div>
            <p className="text-xs text-red-400/70 bg-red-400/10 rounded-lg px-3 py-2">
              This will permanently delete the send record and all associated tracking events. This cannot be undone.
            </p>
            {deleteSendError && <p className="text-red-400 text-xs">{deleteSendError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteSendTarget(null)}
                disabled={deletingSend}
                className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteSend}
                disabled={deletingSend}
                className="px-4 py-2 text-sm bg-red-500/80 hover:bg-red-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {deletingSend ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm send dialog */}
      {confirmSend && sendDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
            <h3 className="font-semibold">Confirm send</h3>
            <div className="text-sm text-white/60 flex flex-col gap-1">
              <p><span className="text-white/30">Newsletter:</span> {selectedNewsletter?.title ?? selectedNewsletterId}{selectedNewsletter && !selectedNewsletter.published ? " (Draft)" : ""}</p>
              <p><span className="text-white/30">Subject:</span> {effectiveSubject}</p>
              <p><span className="text-white/30">List:</span> {sendDialog}</p>
              <p><span className="text-white/30">From:</span> {fromName || "—"}</p>
              <p><span className="text-white/30">Reply-to:</span> {replyTo || "—"}</p>
            </div>
            <p className="text-xs text-white/40">This will send to all active subscribers on the list. This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmSend(false)}
                className="px-4 py-2 text-sm text-white/50 hover:text-white transition-colors"
                disabled={sending}
              >
                Cancel
              </button>
              <button
                onClick={sendToList}
                disabled={sending}
                className="px-4 py-2 text-sm bg-white text-black font-medium rounded-lg hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
