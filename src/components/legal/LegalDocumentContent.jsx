function LegalDocumentContent({ document, privacyContactEmail }) {
  return (
    <div className="space-y-6">
      {document.sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-sm font-bold text-slate-900 sm:text-base">{section.title}</h3>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph} className="mt-2 text-sm leading-6 text-slate-600">
              {paragraph}
            </p>
          ))}
          {section.privacyContact ? (
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Privacy contact: {privacyContactEmail ? (
                <a href={`mailto:${privacyContactEmail}`} className="font-semibold text-red-700 underline underline-offset-2 hover:text-red-900">
                  {privacyContactEmail}
                </a>
              ) : "Please use ACGC’s customer-service contact on this website."}
            </p>
          ) : null}
          {section.items ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
        </section>
      ))}

      {document.references?.length ? (
        <section aria-labelledby="privacy-legal-references">
          <h3 id="privacy-legal-references" className="text-sm font-bold text-slate-900 sm:text-base">
            Legal references
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
            {document.references.map((reference) => (
              <li key={reference.href}>
                <a href={reference.href} target="_blank" rel="noreferrer" className="font-semibold text-red-700 underline underline-offset-2 hover:text-red-900">
                  {reference.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default LegalDocumentContent;
