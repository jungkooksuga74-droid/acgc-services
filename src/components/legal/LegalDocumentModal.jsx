import { Link } from "react-router-dom";
import { X } from "lucide-react";
import LegalDocumentContent from "./LegalDocumentContent";
import { useAdminContactPhone } from "@/hooks/useAdminContactPhone";

function LegalDocumentModal({ document, documentType, onClose, onAcknowledge }) {
  const fullPagePath = documentType === "privacyPolicy" ? "/privacy-policy" : "/terms-and-conditions";
  const { email } = useAdminContactPhone();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-document-title"
        className="flex h-[88dvh] max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-700">ACGC Aluminum Services</p>
            <h2 id="legal-document-title" className="mt-1 text-lg font-bold text-slate-900 sm:text-xl">
              {document.title}
            </h2>
            <p className="mt-1 text-xs text-slate-500">Version {document.version} · Updated {document.updatedOn}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${document.title}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" tabIndex={0}>
          <LegalDocumentContent document={document} privacyContactEmail={documentType === "privacyPolicy" ? email : ""} />
          <Link to={fullPagePath} target="_blank" rel="noreferrer" className="mt-6 inline-flex min-h-10 items-center font-semibold text-red-700 underline underline-offset-2 hover:text-red-900">
            Open the complete {documentType === "privacyPolicy" ? "Privacy Policy" : "Terms and Conditions"} in a new tab
          </Link>
        </div>

        <footer className="flex shrink-0 flex-col-reverse justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Close
          </button>
          {onAcknowledge ? (
            <button
              type="button"
              onClick={onAcknowledge}
              className="min-h-11 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              I Agree / Continue
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

export default LegalDocumentModal;
