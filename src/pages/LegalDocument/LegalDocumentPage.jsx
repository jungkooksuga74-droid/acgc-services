import { Link } from "react-router-dom";
import { getCurrentLegalDocument } from "../../../shared/legalDocuments.js";
import LegalDocumentContent from "@/components/legal/LegalDocumentContent";
import { useAdminContactPhone } from "@/hooks/useAdminContactPhone";

function LegalDocumentPage({ documentType }) {
  const document = getCurrentLegalDocument(documentType);
  const { email } = useAdminContactPhone();
  if (!document) return null;

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <Link to="/signup" className="text-sm font-semibold text-red-700 underline underline-offset-2 hover:text-red-900">
          Return to registration
        </Link>
        <header className="mt-6 border-b border-slate-200 pb-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-700">ACGC Aluminum Services</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{document.title}</h1>
          <p className="mt-2 text-sm text-slate-500">Version {document.version} · Updated {document.updatedOn}</p>
        </header>
        <div className="mt-6">
          <LegalDocumentContent document={document} privacyContactEmail={documentType === "privacyPolicy" ? email : ""} />
        </div>
      </article>
    </main>
  );
}

export default LegalDocumentPage;
