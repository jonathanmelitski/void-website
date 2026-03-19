"use client"

import { useEffect, useState } from "react"
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

  // Send dialog
  const [sendDialog, setSendDialog] = useState<string | null>(null)
  const [selectedNewsletterId, setSelectedNewsletterId] = useState("")
  const [subject, setSubject] = useState("")
  const [replyTo, setReplyTo] = useState(DEFAULT_REPLY_TO)
  const [fromName, setFromName] = useState(DEFAULT_FROM_NAME)
  const [includeWebLink, setIncludeWebLink] = useState(true)
  const [testEmail, setTestEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState("")
  const [testResult, setTestResult] = useState("")
  const [confirmSend, setConfirmSend] = useState(false)

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
    setTestEmail("")
    setSendResult("")
    setTestResult("")
    setConfirmSend(false)
  }

  function buildSendPayload(mode: "list" | "test", extra: Record<string, string>) {
    return {
      mode,
      newsletterId: selectedNewsletterId,
      subject: subject.trim() || undefined,
      replyTo: replyTo.trim() || undefined,
      fromName: fromName.trim() || undefined,
      includeWebLink,
      ...extra,
    }
  }

  async function sendToList() {
    if (!sendDialog || !selectedNewsletterId) return
    setConfirmSend(false)
    setSending(true)
    setSendResult("")
    try {
      const res = await fetch("/api/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSendPayload("list", { listName: sendDialog })),
      })
      const data = await res.json()
      if (res.ok) {
        setSendResult(`Sent to ${data.sent} recipient${data.sent !== 1 ? "s" : ""}`)
        const newsletter = newsletters.find(n => n.id === selectedNewsletterId)
        setSends(prev => [{
          id: Math.random().toString(),
          newsletterId: selectedNewsletterId,
          newsletterTitle: newsletter?.title ?? selectedNewsletterId,
          listName: sendDialog,
          sentAt: new Date().toISOString(),
          sentBy: "you",
          recipientCount: data.sent,
        }, ...prev])
      } else {
        setSendResult(`Error: ${data.error ?? "Send failed"}`)
      }
    } finally {
      setSending(false)
    }
  }

  async function sendTest() {
    if (!sendDialog || !selectedNewsletterId || !testEmail.trim()) return
    setSending(true)
    setTestResult("")
    try {
      const res = await fetch("/api/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSendPayload("test", { email: testEmail.trim() })),
      })
      const data = await res.json()
      if (res.ok) setTestResult(`Test sent to ${testEmail.trim()}`)
      else setTestResult(`Error: ${data.error ?? "Send failed"}`)
    } finally {
      setSending(false)
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
                  <th className="text-left pb-2 font-medium">Recipients</th>
                </tr>
              </thead>
              <tbody>
                {sends.map(s => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-4 text-white/80 max-w-[200px] truncate">{s.newsletterTitle}</td>
                    <td className="py-2.5 pr-4 text-white/60">{s.listName}</td>
                    <td className="py-2.5 pr-4 text-white/40 whitespace-nowrap">
                      <span title={s.sentAt}>{timeAgo(s.sentAt)}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-white/60">{s.sentBy}</td>
                    <td className="py-2.5 text-white/60">{s.recipientCount}</td>
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
              <h3 className="font-semibold">Contacts — {contactsModal}</h3>
              <button
                onClick={() => setContactsModal(null)}
                className="text-white/40 hover:text-white text-lg leading-none transition-colors"
              >
                ×
              </button>
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
                    {contacts.map(c => (
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

            <div className="flex gap-2 pt-2 border-t border-white/10">
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

            {/* Web link */}
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
                <p className={`text-xs ${testResult.startsWith("Error") ? "text-red-400" : "text-green-400/80"}`}>
                  {testResult}
                </p>
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
