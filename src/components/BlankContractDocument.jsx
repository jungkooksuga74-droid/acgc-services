import { ShieldCheck, TriangleAlert } from "lucide-react";
import logo from "@/assets/images/ACGCLOGO1.png";

const POLICIES = [
  {
    title: "Non-Refundable Downpayment.",
    body: "Once a downpayment has been made, it is strictly non-refundable and the order cannot be cancelled.",
  },
  {
    title: "Material Turnover After Cancellation Request.",
    body: "If the customer insists on cancelling after paying the downpayment, no cash or monetary refund will be given. Only the materials already purchased for the order may be turned over to the customer.",
  },
  {
    title: "Repairs Outside the Warranty Period.",
    body: "Service or repair requested after the warranty period has ended is subject to a service/repair fee. The applicable fee will be communicated before the repair work begins.",
  },
];

function BlankLine({ className = "" }) {
  return <span aria-hidden="true" className={`contract-blank-line ${className}`} />;
}

function BlankLines({ count = 1, className = "" }) {
  return (
    <span className={`contract-blank-lines ${className}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <BlankLine key={index} />)}
    </span>
  );
}

function BlankContractDocument({ rowCount, documentRef }) {
  return (
    <div id="blank-contract-content" ref={documentRef} className="contract-paper contract-fixed-light relative mx-auto w-full">
      <header className="contract-brand-header">
        <div className="contract-brand-identity">
          <img src={logo} alt="ACGC Logo" className="contract-brand-logo" />
          <div className="contract-brand-copy">
            <p>ACGC Glass &amp; Aluminum Services</p>
            <p>Glass and Aluminum Specialists</p>
          </div>
        </div>
        <h1>Service Contract</h1>
      </header>

      <section className="contract-info-grid">
        <div className="contract-info-item contract-info-contract"><span>Contract No.</span><p className="contract-blank-info-value" /></div>
        <div className="contract-info-item contract-info-generated"><span>Generated Date</span><p className="contract-blank-info-value" /></div>
        <div className="contract-info-item contract-info-order"><span>Order ID</span><p className="contract-blank-info-value" /></div>
        <div className="contract-info-item contract-info-customer"><span>Customer</span><p className="contract-blank-info-value" /></div>
        <div className="contract-info-item contract-info-address"><span>Site Address</span><p className="contract-blank-info-value" /></div>
      </section>

      <section className="contract-section contract-scope-section">
        <h2 className="contract-section-title">Scope of Work</h2>
        <p className="contract-site-notes contract-blank-notes">
          <span className="contract-blank-notes-label">Additional Notes:</span>
          <BlankLines count={1} />
        </p>
        <div className="contract-scope-chips">
          {[
            "Inspection Date:",
            "Est. Install Date:",
            "Client Type:",
            "Warranty:",
          ].map((label) => (
            <div className="contract-scope-chip" key={label}>
              <span>{label}</span>
              <strong className="contract-blank-chip-value"><BlankLine /></strong>
            </div>
          ))}
        </div>
      </section>

      <section className="contract-items-section">
        <div className="contract-table-block">
          <div className="contract-table-scroll">
            <table className="contract-items-table">
              <thead>
                <tr>
                  <th className="contract-table-index">#</th>
                  <th>Product / Descrip<wbr />tion</th>
                  <th className="contract-table-centered">W x H (Unit)</th>
                  <th className="contract-table-centered">Qty</th>
                  <th className="contract-table-right">Rate</th>
                  <th className="contract-table-centered">War<wbr />ranty</th>
                  <th className="contract-table-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rowCount }, (_, index) => (
                  <tr key={index} className="contract-blank-product-row">
                    <td className="contract-table-index">{index + 1}</td>
                    <td className="contract-table-product"><BlankLines count={3} /></td>
                    <td className="contract-table-centered"><BlankLines count={2} /></td>
                    <td className="contract-table-centered"><BlankLine /></td>
                    <td className="contract-table-right"><BlankLines count={2} /></td>
                    <td className="contract-table-centered contract-table-warranty"><BlankLines count={3} /></td>
                    <td className="contract-table-right contract-table-product contract-table-amount-cell"><BlankLine /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="contract-table-total-row">
            <span className="contract-table-total-label">Total Contract Amount</span>
            <strong className="contract-table-total-amount contract-blank-total"><BlankLine /></strong>
          </div>
        </div>
      </section>

      <section className="contract-payment-warranty-grid">
        <div className="contract-payment-card">
          <h2 className="contract-section-title">Payment Terms</h2>
          <p className="contract-payment-copy contract-blank-payment-terms"><span>Terms:</span><BlankLines count={2} /></p>
          <div className="contract-payment-amounts">
            <div className="contract-payment-amount">
              <span>Required Downpayment:</span>
              <strong className="contract-blank-payment-value"><BlankLine /></strong>
            </div>
            <div className="contract-payment-amount">
              <span>Balance Upon Completion:</span>
              <strong className="contract-blank-payment-value"><BlankLine /></strong>
            </div>
          </div>
        </div>

        <div className="contract-warranty-card">
          <ShieldCheck size={22} strokeWidth={2} aria-hidden="true" />
          <div>
            <h2 className="contract-section-title">Warranty</h2>
            <p><strong><BlankLine className="contract-blank-inline" />-Day Warranty:</strong> ACGC Glass &amp; Aluminum Services provides a <BlankLine className="contract-blank-inline" />-day warranty on installed products and workmanship starting from the installation date.</p>
          </div>
        </div>
      </section>

      <div className="contract-downpayment-alert">
        <TriangleAlert size={16} strokeWidth={2.5} aria-hidden="true" />
        <span>A downpayment of <BlankLine className="contract-blank-inline" /> is required to start the project based on the stated policy.</span>
      </div>

      <section className="contract-section contract-acknowledgment-section">
        <h2 className="contract-section-title">Client Acknowledgment</h2>
        <div className="contract-signature-grid">
          <div className="contract-signature-block">
            <div className="contract-signature-line" aria-hidden="true" />
            <p className="contract-signature-caption">ACGC Representative</p>
            <p className="contract-signature-name">Prepared by ACGC Glass &amp; Aluminum Services</p>
          </div>
          <div className="contract-signature-block">
            <div className="contract-signature-line" aria-hidden="true" />
            <p className="contract-signature-caption">Client Signature &amp; Printed Name</p>
            <p className="contract-signature-name contract-blank-signature-name"><BlankLine /></p>
            <p className="contract-signature-date">Date: __________________</p>
          </div>
        </div>
      </section>

      <section className="contract-section contract-policy-section">
        <h2 className="contract-section-title">Contracts, Terms, Cancellation &amp; Warranty Policies</h2>
        <div className="contract-policy-grid">
          {POLICIES.map((policy, index) => (
            <article className="contract-policy-card" key={policy.title}>
              <div className="contract-policy-heading"><span>{index + 1}.</span><h3>{policy.title}</h3></div>
              <p>{policy.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default BlankContractDocument;
