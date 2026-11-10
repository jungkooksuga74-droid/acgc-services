import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ChevronDown, FileText, Trash2 } from "lucide-react";
import { uploadFiles } from "@/api/uploads";
import {
  getInstallationBilling,
  createExtraCharge,
} from "@/api/orders";
import ExtraChargeReceiptModal from "@/components/ExtraChargeReceiptModal";
import { addExtraChargeReceiptContext } from "@/lib/extraChargeReceipt";
import { subscribeToRealtime } from "@/lib/realtimeEvents";

const money = (value) => `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const getError = (error, fallback) => error?.message || fallback;
const isImageEvidence = (url) => /\.(?:png|jpe?g|gif|webp|bmp)(?:[?#].*)?$/i.test(String(url || ""));
const isPdfEvidence = (url) => /\.pdf(?:[?#].*)?$/i.test(String(url || ""));
const formatIssueDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
};
const issueStatusClass = (status, darkMode) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "resolved") return darkMode ? "bg-emerald-950 text-emerald-200" : "bg-emerald-100 text-emerald-800";
  if (normalized === "for adjustment" || normalized === "return visit required") return darkMode ? "bg-amber-950 text-amber-200" : "bg-amber-100 text-amber-800";
  return darkMode ? "bg-sky-950 text-sky-200" : "bg-sky-100 text-sky-800";
};

export default function InstallationBillingPanel({ order, darkMode = false, readOnly = false, issuesOnly = false, onDataChange }) {
  const user = useMemo(() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(window.localStorage.getItem("user") || "null"); }
    catch { return null; }
  }, []);
  const isAdmin = ["admin", "super_admin"].includes(user?.role);
  const isCustomer = user?.role === "customer";
  const canView = isAdmin || isCustomer || (user?.role === "skilled_worker" && user.staff_access?.modules?.progress_monitoring?.enabled === true && user.staff_access.modules.progress_monitoring.actions?.view === true);
  const orderId = order?._id || order?.id;
  const [data, setData] = useState({ issues: [], charges: [], receipts: [], project_receipts: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [installationDetailsExpanded, setInstallationDetailsExpanded] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [evidencePreview, setEvidencePreview] = useState(null);
  const [chargeDraft, setChargeDraft] = useState({ description: "", reason: "", files: [], items: [{ description: "", category: "Labor", quantity: 1, unit_price: "" }] });
  const panelClass = darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900";
  const fieldClass = `w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-300 bg-white text-slate-900"}`;

  const refresh = useCallback(async () => {
    if (!orderId || !canView || !/^[a-f\d]{24}$/i.test(String(orderId))) return;
    setLoading(true);
    try {
      const result = await getInstallationBilling(orderId);
      const nextData = { issues: result.issues || [], charges: result.charges || [], receipts: result.receipts || [], project_receipts: result.project_receipts || [], project_items: result.project_items || [] };
      setData(nextData);
      onDataChange?.(orderId, nextData);
    } catch (error) {
      toast.error(getError(error, "Could not load installation records."));
    } finally { setLoading(false); }
  }, [orderId, canView, onDataChange]);
  useEffect(() => {
    const timer = window.setTimeout(() => refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => subscribeToRealtime("orders", (event) => {
    if (event.action === "reconcile") return;
    if (!event.orderId || String(event.orderId) === String(orderId)) refresh();
  }), [orderId, refresh]);

  const perform = async (action, successMessage) => {
    setSaving(true);
    try { const result = await action(); toast.success(successMessage); return result ?? true; }
    catch (error) { toast.error(getError(error, "The action could not be completed.")); return false; }
    finally { setSaving(false); }
  };
  const receiptStatus = (receipt) => {
    const charge = data.charges.find((entry) => String(entry._id) === String(receipt.extra_charge));
    const paid = (charge?.payments || []).filter((entry) => entry.status === "verified").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    return paid >= Number(receipt.total) ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid";
  };
  const receiptSnapshot = (receipt) => {
    const charge = data.charges.find((entry) => String(entry._id) === String(receipt.extra_charge));
    return addExtraChargeReceiptContext({
      ...receipt,
      payment_status: receiptStatus(receipt),
      payments: charge?.payments || [],
    }, { ...order, project_items: data.project_items }, data.charges);
  };
  const saveCharge = async (event) => {
    event.preventDefault();
    if (!chargeDraft.description.trim() || !chargeDraft.reason.trim()) return toast.error("Charge description and reason are required.");
    const created = await perform(async () => {
      const itemsPayload = chargeDraft.items.map((item) => ({ ...item, quantity: Number(item.quantity), unit_price: Number(item.unit_price) }));
      let evidence_urls = [];
      if (chargeDraft.files.length) {
        const uploaded = await uploadFiles(chargeDraft.files, undefined, { purpose: "progress-media" });
        evidence_urls = (uploaded.files || []).map((file) => file.url).filter(Boolean);
      }
      const result = await createExtraCharge(orderId, { ...chargeDraft, files: undefined, evidence_urls, installation_issue: null, item_index: null, items: itemsPayload });
      setChargeDraft({ description: "", reason: "", files: [], items: [{ description: "", category: "Labor", quantity: 1, unit_price: "" }] });
      setShowChargeForm(false);
      return result;
    }, "Saved. Charge added to the customer balance and receipt generated.");
    if (!created || created === true) return;
    if (created.receipt) setSelectedReceipt({ ...created.receipt, payment_status: "Unpaid", payments: [] });
  };
  if (!canView) return null;
  if (issuesOnly && (loading || (data.issues.length === 0 && data.charges.length === 0))) return null;

  return (
    <section className={`${issuesOnly ? "mt-3 p-3" : "mt-4 p-3 sm:p-4"} rounded-xl border ${panelClass}`} aria-label={issuesOnly ? "Installation Issue" : undefined} aria-labelledby={issuesOnly ? undefined : "installation-billing-title"}>
      {issuesOnly && <button type="button" aria-expanded={installationDetailsExpanded} aria-controls={`installation-issue-details-${orderId}`} onClick={() => setInstallationDetailsExpanded((expanded) => !expanded)} className={`flex w-full items-center justify-between gap-3 text-left text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${installationDetailsExpanded ? "mb-3" : ""}`}><span>Installation Issue</span><ChevronDown size={18} className={`shrink-0 transition-transform ${installationDetailsExpanded ? "rotate-180" : ""}`} aria-hidden="true" /></button>}
      {!issuesOnly && <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 id="installation-billing-title" className="text-sm font-bold">Installation Issues</h3><p className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Track extra charges and receipts related to installation.</p></div>
        {isAdmin && !readOnly && <button type="button" onClick={() => setShowChargeForm((value) => !value)} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white">{showChargeForm ? "Close charge form" : "Add extra charge"}</button>}
      </div>}
      {(!issuesOnly || installationDetailsExpanded) && <div id={issuesOnly ? `installation-issue-details-${orderId}` : undefined}>
      {!issuesOnly && showChargeForm && isAdmin && !readOnly && <form onSubmit={saveCharge} className={`mt-3 grid gap-2 rounded-lg border p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
        <label className="text-xs font-semibold sm:col-span-2">Charge description<input className={`${fieldClass} mt-1`} value={chargeDraft.description} onChange={(e) => setChargeDraft({ ...chargeDraft, description: e.target.value })} maxLength={1000} required /></label>
        <label className="text-xs font-semibold sm:col-span-2">Reason for additional charge<textarea className={`${fieldClass} mt-1`} value={chargeDraft.reason} onChange={(e) => setChargeDraft({ ...chargeDraft, reason: e.target.value })} maxLength={2000} required rows={2} /></label>
        <div className="sm:col-span-2"><p className="mb-2 text-xs font-bold">Charge items</p>{chargeDraft.items.map((item, index) => <div key={index} className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]"><input className={fieldClass} placeholder="Item description" value={item.description} onChange={(e) => setChargeDraft({ ...chargeDraft, items: chargeDraft.items.map((row, rowIndex) => rowIndex === index ? { ...row, description: e.target.value } : row) })} required /><input className={fieldClass} type="number" min="0.001" step="any" aria-label="Quantity" value={item.quantity} onChange={(e) => setChargeDraft({ ...chargeDraft, items: chargeDraft.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: e.target.value } : row) })} required /><input className={fieldClass} type="number" min="0" step="0.01" placeholder="Unit price" aria-label="Unit price" value={item.unit_price} onChange={(e) => setChargeDraft({ ...chargeDraft, items: chargeDraft.items.map((row, rowIndex) => rowIndex === index ? { ...row, unit_price: e.target.value } : row) })} required /><button type="button" aria-label={`Remove charge item ${index + 1}`} title="Remove item" disabled={chargeDraft.items.length === 1} onClick={() => setChargeDraft({ ...chargeDraft, items: chargeDraft.items.filter((_, rowIndex) => rowIndex !== index) })} className="rounded-lg border px-3 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button></div>)}<button type="button" className="text-xs font-semibold text-blue-600" onClick={() => setChargeDraft({ ...chargeDraft, items: [...chargeDraft.items, { description: "", category: "Labor", quantity: 1, unit_price: "" }] })}>+ Add charge item</button><p className="mt-2 text-xs">Total: <strong>{money(chargeDraft.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0))}</strong></p></div>
        <label className="text-xs font-semibold sm:col-span-2">Supporting image or document<input className={`${fieldClass} mt-1`} type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" multiple onChange={(e) => setChargeDraft({ ...chargeDraft, files: Array.from(e.target.files || []).slice(0, 10) })} /></label>
        <div className="sm:col-span-2"><p className="mb-2 text-xs opacity-70">Saving immediately adds this charge to the customer balance and generates its receipt.</p><button disabled={saving} className="rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Save</button></div>
      </form>}

      {loading ? <p className="mt-3 text-xs opacity-70">Loading records…</p> : <>


        {!issuesOnly && isAdmin && <div className="mt-4 space-y-2"><h4 className="text-xs font-bold uppercase tracking-wide opacity-70">Additional installation charges</h4>{data.charges.length === 0 ? <p className="text-xs opacity-60">No extra charges.</p> : data.charges.map((charge) => {
          const receipt = data.receipts.find((entry) => String(entry._id) === String(charge.receipt));
          return <article key={charge._id} className={`rounded-xl border p-4 ${darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50/60"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <strong className="min-w-0 text-base font-bold leading-6">{charge.description}</strong>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${darkMode ? "bg-violet-950 text-violet-200" : "bg-violet-100 text-violet-900"}`}>{receipt || ["Approved", "Receipt Generated"].includes(charge.status) ? "Added to balance" : charge.status}</span>
            </div>
            {(charge.reason || charge.items?.length > 0) && <div className={`mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              {charge.reason && <div className="min-w-0"><p className={`text-xs font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Reason</p><p className={`mt-1 text-sm font-medium leading-6 ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{charge.reason}</p></div>}
              {charge.items?.length > 0 && <div className="min-w-0"><p className={`text-xs font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Items</p><div className={`mt-1 space-y-0.5 text-sm leading-6 ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{charge.items.map((item, index) => <p key={`${item.description}-${index}`}><span className="font-medium">{item.description}</span> <span>({item.quantity} × {money(item.unit_price)})</span></p>)}</div></div>}
            </div>}
            {charge.evidence_urls?.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{charge.evidence_urls.map((url, index) => <button key={url} type="button" onClick={() => setEvidencePreview({ url, label: `Supporting file ${index + 1}` })} className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${darkMode ? "border-slate-600 text-blue-200 hover:bg-slate-700" : "border-slate-200 text-blue-700 hover:bg-white"}`}>Supporting file {index + 1}</button>)}</div>}
            <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <div><p className={`text-xs font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Added to project total</p><p className={`mt-0.5 text-lg font-bold ${darkMode ? "text-emerald-300" : "text-emerald-700"}`}>{money(charge.total)}</p></div>
              {receipt && <button type="button" className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${darkMode ? "border-blue-500/40 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20" : "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"}`} onClick={() => setSelectedReceipt(receiptSnapshot(receipt))}><FileText size={15} aria-hidden="true" /><span>View receipt</span></button>}
            </div>
          </article>; })}</div>}
        {isCustomer && data.issues.length > 0 && <section className={`${issuesOnly ? "mt-2 space-y-1.5" : "mt-4 space-y-2"}`} aria-label="Reported installation issues">
          {!issuesOnly && <h4 className="text-xs font-bold uppercase tracking-wide opacity-70">Installation issues</h4>}
          {data.issues.map((issue) => {
            const hasItemIndex = issue.item_index !== null && issue.item_index !== undefined && issue.item_index !== "";
            const affectedProduct = hasItemIndex ? order?.items?.[Number(issue.item_index)]?.name : "";
            const genericProductNames = ["project installation", "project / all items", "all items"];
            const showAffectedProduct = affectedProduct && !genericProductNames.includes(String(affectedProduct).trim().toLowerCase());
            const recordedAt = formatIssueDate(issue.createdAt || issue.created_at);
            const reporter = issue.reported_by_name || issue.recorded_by_name || "ACGC team";
            return <article key={issue._id} className={`rounded-lg border ${issuesOnly ? "p-2" : "p-3"} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <strong className={issuesOnly ? "text-xs" : "text-sm"}>{issue.issue_type || "Installation issue"}</strong>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${issueStatusClass(issue.status, darkMode)}`}>{issue.status || "Open"}</span>
              </div>
              {issue.description && <p className={`${issuesOnly ? "mt-1 text-xs" : "mt-2 text-sm"} whitespace-pre-wrap break-words`}>{issue.description}</p>}
              {showAffectedProduct && <p className="mt-1 text-xs opacity-70">Affected product: {affectedProduct}</p>}
              <p className="mt-1 text-xs opacity-70">{recordedAt ? `Recorded ${recordedAt}` : "Recorded"} by {reporter}</p>
              {issue.measurement_details && <p className={`${issuesOnly ? "mt-1" : "mt-2"} whitespace-pre-wrap break-words text-xs`}><span className="font-semibold">Measurements:</span> {issue.measurement_details}</p>}
              {issue.required_action && <p className="mt-1 whitespace-pre-wrap break-words text-xs"><span className="font-semibold">Required action:</span> {issue.required_action}</p>}
              {issue.status === "Return Visit Required" && issue.return_visit?.date && <div className={`mt-2 rounded-md p-2 text-xs ${darkMode ? "bg-amber-950 text-amber-100" : "bg-amber-50 text-amber-900"}`}>
                <p className="font-semibold">Return visit scheduled</p>
                <p>{formatIssueDate(issue.return_visit.date)}{issue.return_visit.time ? ` at ${issue.return_visit.time}` : ""}</p>
                {issue.return_visit.reason && <p className="mt-1">{issue.return_visit.reason}</p>}
              </div>}
              {issue.evidence_urls?.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{issue.evidence_urls.map((url, index) => <button key={url} type="button" onClick={() => setEvidencePreview({ url, label: `Issue evidence ${index + 1}` })} className="text-xs font-semibold text-blue-600 underline">Evidence {index + 1}</button>)}</div>}
            </article>;
          })}
        </section>}
        {isCustomer && issuesOnly && data.charges.length > 0 && <section className="mt-3 space-y-2" aria-label="Additional installation charges to pay">
          <h4 className={`text-sm font-bold uppercase tracking-wide ${darkMode ? "text-slate-300" : "text-slate-600"}`}>Additional charges</h4>
          {data.charges.map((charge) => {
            const verifiedPayments = (charge.payments || []).filter((payment) => payment.status === "verified").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
            const amountDue = Math.max(0, Math.round((Number(charge.total || 0) - verifiedPayments) * 100) / 100);
            return <article key={charge._id} className={`rounded-lg border p-4 ${darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50/70"}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                <div className="min-w-0 flex-1">
                  <strong className="block text-base font-bold leading-6">{charge.description}</strong>
                </div>
                <div className={`shrink-0 border-t pt-2 sm:border-t-0 sm:pt-0 sm:text-right ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <span className={`text-xs font-semibold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Amount due</span>
                  <p className={`mt-0.5 whitespace-nowrap text-base font-bold ${darkMode ? "text-emerald-300" : "text-emerald-700"}`}>{money(amountDue)}</p>
                </div>
              </div>
              {(charge.reason || charge.items?.length > 0) && <div className={`mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                {charge.reason && <div className="min-w-0"><p className={`text-xs font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Reason</p><p className={`mt-1 text-base font-medium leading-6 ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{charge.reason}</p></div>}
                {charge.items?.length > 0 && <div className="min-w-0"><p className={`text-xs font-bold uppercase tracking-wide ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Items</p><div className={`mt-1 space-y-0.5 text-base leading-6 ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{charge.items.map((item, index) => <p key={`${item.description}-${index}`}><span className="font-medium">{item.description}</span> <span className="text-sm">({item.quantity} × {money(item.unit_price)})</span></p>)}</div></div>}
              </div>}
            </article>;
          })}
        </section>}
        {!issuesOnly && isCustomer && <div className="mt-4 space-y-2"><h4 className="text-xs font-bold uppercase tracking-wide opacity-70">Installation charges and receipts</h4>{data.charges.length === 0 ? <p className="text-xs opacity-60">No additional installation charges.</p> : data.charges.map((charge) => { const receipt = data.receipts.find((entry) => String(entry._id) === String(charge.receipt)); return <article key={charge._id} className={`rounded-lg border p-3 ${darkMode ? "border-slate-700" : "border-slate-200"}`}><strong className="text-sm">{charge.description}</strong><p className="mt-1 text-xs">Reason: {charge.reason}</p><p className="mt-1 font-bold">{money(charge.total)} · {receipt ? receiptStatus(receipt) : "Added to balance"}</p>{charge.evidence_urls?.length > 0 && <div className="mt-1 flex gap-2">{charge.evidence_urls.map((url, index) => <button key={url} type="button" onClick={() => setEvidencePreview({ url, label: `Supporting file ${index + 1}` })} className="text-xs font-semibold text-blue-600 underline">Supporting file {index + 1}</button>)}</div>}{receipt && <button type="button" className="mt-2 rounded-lg border px-3 py-2 text-xs font-semibold" onClick={() => setSelectedReceipt(receiptSnapshot(receipt))}>View / Download Receipt · {receipt.receipt_number}</button>}</article>; })}</div>}
      </>}
      </div>}

      <ExtraChargeReceiptModal receipt={selectedReceipt} darkMode={darkMode} enableSend={isAdmin && !readOnly} onReceiptSent={() => refresh()} onClose={() => setSelectedReceipt(null)} />
      {evidencePreview && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEvidencePreview(null); }}><section role="dialog" aria-modal="true" aria-label={evidencePreview.label} className={`flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border shadow-2xl ${panelClass}`}><header className="flex shrink-0 items-center justify-between gap-3 border-b p-3"><h3 className="truncate text-sm font-bold">{evidencePreview.label}</h3><div className="flex shrink-0 items-center gap-2"><a href={evidencePreview.url} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-xs font-semibold">Open original</a><button type="button" aria-label="Close evidence preview" onClick={() => setEvidencePreview(null)} className="rounded-lg border p-2"><span aria-hidden="true">×</span></button></div></header><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/5 p-2 sm:p-4">{isImageEvidence(evidencePreview.url) ? <img src={evidencePreview.url} alt={evidencePreview.label} className="max-h-[78vh] max-w-full rounded-lg object-contain" /> : isPdfEvidence(evidencePreview.url) ? <iframe title={evidencePreview.label} src={evidencePreview.url} className="h-[78vh] w-full rounded-lg bg-white" /> : <div className="text-center"><p className="text-sm">Preview is unavailable for this file type.</p><a href={evidencePreview.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-blue-600 underline">Open or download file</a></div>}</div></section></div>}


    </section>
  );
}
