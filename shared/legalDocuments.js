// Keep prior entries when revising a document so recorded acknowledgments can
// still be matched to the wording that was shown at the time.
export const LEGAL_DOCUMENT_HISTORY = {
  privacyPolicy: [
    {
      version: "1.0-2026-11-10",
      updatedOn: "November 10, 2026",
      title: "Privacy Policy",
      sections: [
        {
          title: "Who handles your information",
          paragraphs: [
            "ACGC Aluminum Services (ACGC) operates this website and is responsible for the personal information processed through its customer account, product, order, installation, and repair features. For a privacy question or request, email the ACGC contact shown below with “Data Privacy Request” in the subject. Include the email address on your account and describe your request; do not send your password.",
          ],
          privacyContact: true,
        },
        {
          title: "Information ACGC collects",
          paragraphs: [
            "When you register, ACGC collects your first and last name, email address, username, phone number, street address, city, province, postal code, and password. The system stores a bcrypt password hash rather than your readable password. It also keeps account, email-verification, password-reset, and security records needed to operate your account.",
            "If you use customer services, ACGC may also process product selections and measurements, cart and quote details, order and tracking records, delivery or project-site addresses, inspection and installation dates, contract and cancellation records, repair or warranty descriptions, reviews, and messages you submit. Payment records may include payment method, amount, transaction reference, and a payment-proof file. Photos or documents you choose to upload may contain personal information visible in them. Please crop or cover unrelated account numbers, government IDs, or other details before uploading.",
            "The website stores authentication and account information in your browser’s local storage and uses session storage for a temporary client identifier and some customer-session features. Hosting and security providers may also process technical connection information, such as IP address, browser, and service logs, to deliver and protect the website.",
          ],
        },
        {
          title: "Why ACGC uses this information",
          items: [
            "Create and maintain your account, verify your email, authenticate sign-in, and help you recover access.",
            "Respond to quote or order requests; confirm product specifications; arrange site inspections, fabrication, delivery, and installation; and provide tracking, customer support, warranty, and repair services.",
            "Record and verify payments, payment proofs, receipts, contract decisions, cancellations, and other transactions related to a project.",
            "Send account, security, order, payment, appointment, and service messages that are needed to provide the requested service.",
            "Protect accounts and the service, investigate suspected misuse, maintain business records, and meet applicable legal obligations.",
          ],
        },
        {
          title: "Legal grounds and your acknowledgment",
          paragraphs: [
            "ACGC processes information needed to take steps you request before an order, provide an account or service you request, meet legal obligations, and pursue legitimate interests such as protecting accounts and keeping accurate transaction records, while respecting your rights. Where consent is the appropriate legal basis for an optional use, ACGC will request that consent separately and explain that choice.",
            "Acknowledging this notice records that it was presented to you. It is not blanket consent to every kind of processing and is not the legal basis for all account or order processing.",
          ],
        },
        {
          title: "Who may receive information",
          paragraphs: [
            "ACGC staff who need the information to support your account or perform order, inspection, installation, payment, or repair work may access relevant records according to their system permissions. ACGC also uses service providers that operate parts of the website: Vercel for website/backend hosting, MongoDB for the application database, Cloudinary for uploaded files and encrypted system-backup files when configured, and Brevo or the SMTP provider configured by ACGC to send email. These providers process information to provide their services to ACGC. Because they are cloud services, information may be processed in countries where their infrastructure operates; the exact locations depend on ACGC’s deployment and provider settings.",
            "The website does not use an integrated card-payment gateway. If you pay through a bank, e-wallet, or another service outside the website, that provider handles the payment under its own privacy terms. ACGC receives the payment details and proof you submit in the ACGC system. Information may also be disclosed where required by law or needed to establish, exercise, or defend legal claims.",
          ],
        },
        {
          title: "Storage, security, and retention",
          paragraphs: [
            "ACGC uses account authentication and role-based access controls, stores passwords as hashes, and limits file uploads to authorized system functions. System backups are encrypted before storage. These safeguards reduce risk but cannot guarantee that any online service is completely secure.",
            "Account information is kept while your account is active. Order, payment, contract, inspection, installation, repair, and uploaded-file records may be kept while needed to complete services, handle warranty or customer-support matters, maintain business records, or meet legal obligations. The current system does not enforce an automatic deletion period for account, project, or uploaded-file records. Encrypted system backups follow a 30-day cleanup rule that removes older copies but preserves the latest backup, which may remain until a later backup replaces it. When information is no longer needed and no lawful reason requires it to be kept, it should be securely deleted or de-identified. Contact ACGC if you need information about how long a particular record is kept.",
          ],
        },
        {
          title: "Your privacy rights",
          paragraphs: [
            "Under the Data Privacy Act of 2012, you may ask whether ACGC processes your personal information, request access to or correction of it, object to certain processing, and request blocking, erasure, or data portability where applicable. You may also seek indemnity for damage caused by inaccurate, incomplete, outdated, false, unlawfully obtained, or unauthorized use of your information, as provided by law. These rights are subject to legal conditions and exceptions. You may lodge a complaint with the National Privacy Commission.",
            "To make a request, email acgc.services00@email.com with “Data Privacy Request” in the subject. ACGC may ask for reasonable information to verify that you control the account before acting. The NPC’s guidance on data-subject rights is available at privacy.gov.ph/data-subject-rights/.",
          ],
        },
        {
          title: "Updates to this notice",
          paragraphs: [
            "ACGC may revise this notice when its services or data practices change. The version and acknowledgment time shown to you at registration are recorded with your account. A later version does not automatically mark existing customers as having acknowledged it; ACGC must present an updated notice and obtain a new acknowledgment where appropriate.",
          ],
        },
      ],
      references: [
        { label: "Republic Act No. 10173 (Data Privacy Act of 2012)", href: "https://officialgazette.gov.ph/2012/15/republic-act-no-10173" },
        { label: "Implementing Rules and Regulations of RA 10173", href: "https://privacy.gov.ph/wp-content/uploads/2023/06/IRR_RA-10173-as-amended.pdf" },
        { label: "NPC Circular No. 2023-04: Guidelines on Consent", href: "https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Circular-No.-2023-04_Guidelines-on-Consent_07Nov2023.pdf" },
        { label: "NPC Data Subject Rights", href: "https://privacy.gov.ph/data-subject-rights/" },
      ],
    },
  ],
  termsAndConditions: [
    {
      version: "1.0-2026-11-10",
      updatedOn: "November 10, 2026",
      title: "ACGC Aluminum Services Terms and Conditions",
      sections: [
        {
          title: "1. Eligibility and account information",
          paragraphs: [
            "You must be at least 18 years old to create an account. Provide accurate information and keep your email, phone number, and project details current. You are responsible for keeping your password and verification links private and for activity performed through your account. Contact ACGC promptly if you believe someone else has accessed it.",
          ],
        },
        {
          title: "2. Acceptable use",
          paragraphs: [
            "Use the website for lawful personal or business dealings with ACGC. Do not impersonate another person, submit false order or payment information, interfere with the website, attempt unauthorized access, or upload unlawful, harmful, or unrelated material. ACGC may restrict access when reasonably needed to protect customers, staff, or the service, subject to applicable law.",
          ],
        },
        {
          title: "3. Products, estimates, and order requests",
          paragraphs: [
            "Product selections, dimensions, options, and online estimates help ACGC understand your request. Glass and aluminum work may require shop discussion or an on-site inspection before final specifications, price, scope, and schedule can be confirmed. Submitting an online request is not by itself confirmation that ACGC has accepted the project. ACGC will provide the applicable quotation, contract, and project terms for your review.",
          ],
        },
        {
          title: "4. Inspection, fabrication, delivery, and installation",
          paragraphs: [
            "You are responsible for providing an accurate project-site address and reasonable access for agreed inspections or installation appointments. Dates shown before confirmation are estimates and may change because of site conditions, materials, safety, weather, or other practical constraints. ACGC will coordinate material changes to the schedule with you.",
          ],
        },
        {
          title: "5. Payment and payment verification",
          paragraphs: [
            "Prices, deposits or downpayments, balances, due dates, and any agreed additional charges are those stated in the quotation, accepted contract, invoice, or other written confirmation for your project. Pay using the method and schedule agreed with ACGC. If you submit a payment proof or transaction reference online, it remains subject to review; uploading proof alone does not mean ACGC has verified or received the payment. Keep your own payment receipt.",
          ],
        },
        {
          title: "6. Changes, cancellations, and refunds",
          paragraphs: [
            "Contact ACGC as soon as possible to request a change or cancellation. A request is not effective until ACGC confirms how it affects the project. Any amount due, refund, or other consequence depends on work already performed, materials or services committed, the written project terms, and applicable law. Do not rely on a website status alone for a refund or cancellation confirmation.",
          ],
        },
        {
          title: "7. Warranty, repair, and customer submissions",
          paragraphs: [
            "Warranty coverage and repair eligibility depend on the product, project records, inspection findings, and the written warranty or quotation given for that work. A repair request may require photos, inspection, and a separate quotation before paid work is scheduled. You confirm that content and files you submit are relevant to the request and that you are allowed to share them with ACGC for that purpose.",
          ],
        },
        {
          title: "8. Privacy and electronic messages",
          paragraphs: [
            "ACGC uses account and project information to provide the services you request, as explained in the separate Privacy Notice. Account verification and service-related messages may be sent to the email address or phone number you provide. You can read the full Privacy Notice at the ACGC Privacy Policy page.",
          ],
        },
        {
          title: "9. Website availability and changes",
          paragraphs: [
            "ACGC may maintain, update, or temporarily limit the website for security, maintenance, or operational reasons. ACGC may update these terms when its services or legal requirements change. Updated terms will be presented for acceptance when required; continued access alone will not be treated as acceptance where the law requires a separate agreement.",
          ],
        },
        {
          title: "10. Questions and applicable law",
          paragraphs: [
            "For questions about these terms, orders, payments, installation, or repairs, contact ACGC through the customer-service contact displayed on this website. These terms are governed by applicable Philippine law, including consumer-protection requirements.",
          ],
        },
      ],
    },
  ],
};

export const CURRENT_LEGAL_DOCUMENT_VERSIONS = Object.freeze({
  privacyPolicy: LEGAL_DOCUMENT_HISTORY.privacyPolicy.at(-1).version,
  termsAndConditions: LEGAL_DOCUMENT_HISTORY.termsAndConditions.at(-1).version,
});

export const LEGAL_DOCUMENT_VERSION_HISTORY = Object.freeze({
  privacyPolicy: LEGAL_DOCUMENT_HISTORY.privacyPolicy.map(({ version }) => version),
  termsAndConditions: LEGAL_DOCUMENT_HISTORY.termsAndConditions.map(({ version }) => version),
});

export const getCurrentLegalDocument = (documentType) => {
  const history = LEGAL_DOCUMENT_HISTORY[documentType];
  return Array.isArray(history) ? history.at(-1) || null : null;
};
