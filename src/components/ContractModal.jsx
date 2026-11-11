import { FileText, ShieldCheck, TriangleAlert, X } from "lucide-react";
import logo from "@/assets/images/ACGCLOGO1.png";
import acceptedStamp from "@/assets/images/accepted-stamp.svg";
import { formatDateToMMMDDYYYY } from "@/lib/dateUtils";
import { getFinalProjectCost, getRequiredDownpayment } from "@/lib/orderPricing";
import { getContractBladeDetails } from "@/pages/SiteInspection/contractState";

function ContractModal({ isOpen, onClose, inspection, contractData, onAccept, onDecline, onRegenerate, isLoading, actionError, onDownload, onDownloadPNG, onPrint, onSendToCustomer, isSendingToCustomer = false, notificationRecordId = null, transparentBackdrop = false, acceptedOverride, awaitingResponseOverride, hidePaymentAmounts = false }) {
  if (!isOpen || !inspection || !contractData) return null;

  const darkMode = false;

  const formatCurrency = (value) => hidePaymentAmounts ? "\u2022\u2022\u2022\u2022\u2022\u2022" : new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);

  const shellClass = darkMode
    ? "mobile-fullscreen-dialog flex h-[94dvh] max-h-[94dvh] w-[min(100%,960px)] flex-col overflow-hidden rounded-2xl border border-gray-400 bg-[#e5e5e5] shadow-2xl"
    : "mobile-fullscreen-dialog flex h-[94dvh] max-h-[94dvh] w-[min(100%,960px)] flex-col overflow-hidden rounded-2xl bg-[#e5e5e5] shadow-2xl";
  const headerClass = "sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-gray-300 bg-white px-3 py-2 sm:px-4";
  const titleClass = "text-lg font-bold text-black";
  const buttonShellClass = "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 hover:bg-gray-100 sm:text-sm";
  const closeButtonClass = "rounded-lg p-1.5 text-gray-700 hover:bg-gray-100";
  const contentClass = "contract-paper contract-fixed-light relative mx-auto w-full";

  const formatDate = (value, fallback = "N/A") => {
    if (!value) return fallback;
    return formatDateToMMMDDYYYY(value) || value;
  };

  const orderStatus = String(contractData.orderStatus || inspection.status || contractData.status || "").toLowerCase();
  const contractStatus = String(contractData.rawContractStatus || contractData.contractStatus || inspection.contract_status || "").toLowerCase();
  const isAccepted = acceptedOverride ?? (orderStatus === "contract_accepted" || contractStatus === "accepted");
  const isAwaitingCustomerResponse = awaitingResponseOverride ?? (orderStatus === "contract_sent" || (orderStatus === "site_inspection" && contractStatus === "sent") || contractStatus === "sent");
  const isWalkInCustomer = inspection.order_type === "walk_in_customer" || inspection.acceptance_method === "walk_in_signed_contract";
  const actionsAllowed = Boolean(onAccept || onDecline) && isAwaitingCustomerResponse && !isAccepted && !isWalkInCustomer;
  const totalAmount = getFinalProjectCost({ ...inspection, ...contractData, final_project_cost: inspection.final_project_cost });
  const isFullPaymentMethod = String(inspection.payment_terms || "").trim() === "full_payment";
  const downPayment = getRequiredDownpayment({ ...inspection, ...contractData, final_project_cost: totalAmount });
  const contractItems = contractData.items || [];
  const sourceItems = inspection.items || [];
  const getItemWarrantyPeriod = (item, index) => (
    item.warrantyPeriod ?? sourceItems[index]?.warranty_period ?? inspection.warranty_period
  );
  const itemWarrantyPeriods = contractItems.map((item, index) => getItemWarrantyPeriod(item, index));
  const hasDifferentItemWarranties = new Set(itemWarrantyPeriods.map((period) => String(period ?? ""))).size > 1;
  const isPerProductWarranty = contractItems.length > 1 && (
    inspection.warranty_assignment_mode === "per_product" || hasDifferentItemWarranties
  );
  const isNoWarranty = inspection.warranty_period === "No Warranty";
  const hasCustomWarranty = !isNoWarranty && (inspection.warranty_period === "Custom" || (
    Number.isFinite(Number(inspection.warranty_period)) &&
    Number(inspection.warranty_period) > 0 &&
    ![30, 90].includes(Number(inspection.warranty_period))
  ));
  const warrantyPeriod = hasCustomWarranty
    ? Number(inspection.custom_warranty_days || inspection.warranty_period || 90)
    : Number(inspection.warranty_period ?? inspection.custom_warranty_days ?? 90) || 90;
  const warrantyPeriodLabel = isPerProductWarranty
    ? "Assigned per product below"
    : isNoWarranty ? "No Warranty" : `${warrantyPeriod} days`;
  const getItemWarrantyDetails = (item, index) => {
    const sourceItem = sourceItems[index] || {};
    const period = getItemWarrantyPeriod(item, index);
    const customDays = item.warrantyCustomDays ?? sourceItem.custom_warranty_days ?? inspection.custom_warranty_days;
    const periodText = period === "No Warranty"
      ? "No Warranty"
      : period === "Custom"
        ? `${Number(customDays) || 90} days`
        : Number.isFinite(Number(period))
          ? `${Number(period)} days`
          : String(period || `${warrantyPeriod} days`);
    const start = item.warrantyStartDate ?? sourceItem.warranty_start_date;
    const expiry = item.warrantyExpiryDate ?? sourceItem.warranty_expiry_date;
    return { periodText, start, expiry, hasCoverage: period !== "No Warranty" };
  };
  const inspectionDate = contractData.siteInspectionDate || formatDate(inspection.inspection_date, "TBD");
  const installationDate = formatDate(inspection.estimated_installation_date, "TBD");
  const customerName = contractData.customerName || inspection.customer_name || "Customer";
  const siteAddress = contractData.projectLocation || inspection.shipping_address || "N/A";
  const paymentTerms = contractData.paymentTerms || inspection.payment_terms || (isFullPaymentMethod
    ? "Full payment is required before project commences."
    : "50% downpayment, 50% upon completion");
  const siteNotes = inspection.inspection_notes || inspection.site_notes || "No additional site notes provided.";
  const paymentReceivedLabel = isFullPaymentMethod ? "Full Payment Required" : "Required Downpayment";
  const balanceLabel = isFullPaymentMethod ? "Balance Due" : "Balance Upon Completion";
  const agreedPaymentDate = contractData.agreedPaymentDate || formatDate(inspection.agreed_payment_date, null);
  return (
    <div className={`${transparentBackdrop ? "customer-modal-overlay" : ""} contract-modal-overlay mobile-fullscreen-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-1.5`}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Service Contract"
        data-notification-record-id={notificationRecordId || undefined}
        data-notification-target={notificationRecordId ? "contract" : undefined}
        className={`${shellClass} contract-modal-shell ${notificationRecordId ? "notification-target-highlight" : ""}`}
      >
        <div className={`${headerClass} contract-modal-toolbar`}>
          <div className="contract-toolbar-heading">
            <h2 className={titleClass}>Service Contract</h2>
            {actionError && <p className={`mt-1 text-sm font-medium ${darkMode ? "text-slate-300" : "text-slate-700"}`}>{actionError}</p>}
          </div>
          <div className="contract-toolbar-actions flex flex-wrap items-center gap-2">
            <div className="contract-toolbar-utility">
            {onDownload && (
              <button type="button" onClick={onDownload} className={`${buttonShellClass} inline-flex items-center gap-2`}>
                <FileText size={15} />
                Download PDF
              </button>
            )}
            {onDownloadPNG && <button type="button" onClick={onDownloadPNG} className={buttonShellClass}>Download PNG</button>}
            {onPrint && <button type="button" onClick={onPrint} className={buttonShellClass}>Print Contract</button>}
            {onRegenerate && contractData.contractNeedsRegeneration && !isAccepted && (
              <button type="button" onClick={onRegenerate} disabled={isLoading} className={`${buttonShellClass} disabled:cursor-not-allowed disabled:opacity-60`}>
                Generate New Version
              </button>
            )}
            </div>
            <div className="contract-toolbar-controls">
            {onSendToCustomer && !isAccepted && (
              <button type="button" onClick={onSendToCustomer} disabled={isSendingToCustomer || isAwaitingCustomerResponse} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60">
                {isSendingToCustomer ? "Sending..." : isAwaitingCustomerResponse ? "Sent" : "Send Contract to Customer"}
              </button>
            )}
            {isAccepted && <span className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-bold text-black">&#10003; Contract Accepted &amp; Signed</span>}
            {actionsAllowed && onAccept && <button type="button" onClick={onAccept} disabled={isLoading} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60">{isLoading ? "Signing..." : "Accept & Sign Contract"}</button>}
            {actionsAllowed && onDecline && <button type="button" onClick={onDecline} disabled={isLoading} className="rounded-lg border border-black bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-gray-100 disabled:opacity-60">{isLoading ? "Declining..." : "Decline"}</button>}
            <button type="button" onClick={onClose} aria-label="Close contract" className={closeButtonClass}><X size={22} /></button>
            </div>
          </div>
        </div>

        {contractStatus === "declined" && inspection.contractDeclineReason && (
          <div className={`border-b px-5 py-3 text-sm ${darkMode ? "border-slate-500 bg-slate-800 text-slate-100" : "border-gray-300 bg-gray-100 text-gray-900"}`}>
            <span className="font-bold">Contract declined:</span> {inspection.contractDeclineReason}
          </div>
        )}

        <div className="contract-page-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div id="contract-content" className={contentClass}>
            {isAccepted && <img src={acceptedStamp} alt="Accepted stamp" className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-4/5 -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] opacity-20" />}

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
              <div className="contract-info-item contract-info-contract"><span>Contract No.</span><p>{inspection.contractId || contractData.contractNumber || "N/A"}</p></div>
              <div className="contract-info-item contract-info-generated"><span>Generated Date</span><p>{inspection.contractGeneratedAt ? formatDate(inspection.contractGeneratedAt) : contractData.contractDate || "N/A"}</p></div>
              <div className="contract-info-item contract-info-order"><span>Order ID</span><p>{inspection.tracking || inspection._id || inspection.id || contractData.orderNumber || "N/A"}</p></div>
              <div className="contract-info-item contract-info-customer"><span>Customer</span><p>{customerName}</p></div>
              <div className="contract-info-item contract-info-address"><span>Site Address</span><p>{siteAddress}</p></div>
            </section>

            <section className="contract-section contract-scope-section">
              <h2 className="contract-section-title">Scope of Work</h2>
              <p className="contract-site-notes">{siteNotes}</p>
              <div className="contract-scope-chips">
                <div className="contract-scope-chip"><span>Inspection Date:</span><strong>{inspectionDate}</strong></div>
                <div className="contract-scope-chip"><span>Est. Install Date:</span><strong>{installationDate}</strong></div>
                <div className="contract-scope-chip"><span>Client Type:</span><strong>{inspection.order_type === "walk_in_customer" ? "Walk-in" : "Online"}</strong></div>
                <div className="contract-scope-chip"><span>Warranty:</span><strong>{warrantyPeriodLabel}</strong></div>
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
                      {contractItems.map((item, index) => {
                        const warranty = getItemWarrantyDetails(item, index);
                        const sourceItem = sourceItems[index] || {};
                        const bladeDetails = getContractBladeDetails(item, sourceItem);
                        return (
                          <tr key={`${item.name || "item"}-${index}`}>
                            <td className="contract-table-index">{index + 1}</td>
                            <td className="contract-table-product">
                              <div className="contract-table-product-name">{item.name || "Item"}</div>
                              {bladeDetails.isBlade && !bladeDetails.hasPriceOverride && (
                                <div className="contract-table-subtext">
                                  <div>{bladeDetails.glassName || "Glass"}{" \u00b7 "}{bladeDetails.bladeCount} blades{" \u00b7 "}<span>{formatCurrency(bladeDetails.bladeRate)}</span>/blade</div>
                                  {bladeDetails.saleMode === "frame" && (
                                    <div>Frame: {bladeDetails.frameName || "Selected frame"}{bladeDetails.framePrice > 0 ? ` \u00b7 ${formatCurrency(bladeDetails.framePrice)}` : ""}</div>
                                  )}
                                </div>
                              )}
                              {bladeDetails.isBlade && bladeDetails.hasPriceOverride && (
                                <div className="contract-table-subtext">Product price override</div>
                              )}
                              {(item.additionalProjectCharges || []).map((charge, chargeIndex) => (
                                <div key={`item-charge-${index}-${chargeIndex}`} className="contract-table-charge">
                                  + {charge.name}: <span>{formatCurrency(charge.amount)}</span>{charge.note ? ` \u00b7 ${charge.note}` : ""}
                                </div>
                              ))}
                            </td>
                            <td className="contract-table-centered"><span className="contract-table-dimensions">{item.width || 0} x {item.height || 0}</span> <span className="contract-table-measurement-unit">({item.unit || sourceItem.measurement_unit || "in"})</span></td>
                            <td className="contract-table-centered">{item.quantity || 1}</td>
                            <td className="contract-table-right contract-table-rate-cell">{bladeDetails.isBlade && !bladeDetails.hasPriceOverride ? <><span className="contract-table-rate-amount contract-table-amount">{formatCurrency(bladeDetails.bladeRate)}</span> / blade{bladeDetails.framePrice > 0 ? <div className="contract-table-subtext">+ <span className="contract-table-rate-amount contract-table-amount">{formatCurrency(bladeDetails.framePrice)}</span> frame</div> : null}</> : <span className="contract-table-rate-amount">{formatCurrency(item.unitPrice)}</span>}</td>
                            <td className="contract-table-centered contract-table-warranty">
                              <div className="contract-table-warranty-period">{warranty.periodText}</div>
                              {warranty.hasCoverage && (
                                <div className="contract-table-subtext">
                                  <div>Start: {formatDate(warranty.start, "TBD")}</div>
                                  <div>End: {formatDate(warranty.expiry, "TBD")}</div>
                                </div>
                              )}
                            </td>
                            <td className="contract-table-right contract-table-product contract-table-amount-cell"><span className="contract-table-amount">{formatCurrency(item.amount)}</span></td>
                          </tr>
                        );
                      })}
                      {(inspection.project_additional_charges || []).map((charge, index) => (
                        <tr key={`project-charge-${index}`} className="contract-table-additional-charge">
                          <td className="contract-table-index">+</td>
                          <td className="contract-table-product">{charge.name || "Additional project charge"}{charge.note && <div className="contract-table-subtext">{charge.note}</div>}</td>
                          <td className="contract-table-centered">&#8212;</td>
                          <td className="contract-table-centered">1</td>
                          <td className="contract-table-right"><span className="contract-table-amount">{formatCurrency(charge.amount)}</span></td>
                          <td className="contract-table-centered">&#8212;</td>
                          <td className="contract-table-right contract-table-product contract-table-amount-cell"><span className="contract-table-amount">{formatCurrency(charge.amount)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="contract-table-total-row">
                  <span className="contract-table-total-label">Total Contract Amount</span>
                  <strong className="contract-table-total-amount">{formatCurrency(totalAmount)}</strong>
                </div>
              </div>
            </section>

            <section className="contract-payment-warranty-grid">
              <div className="contract-payment-card">
                <h2 className="contract-section-title">Payment Terms</h2>
                <p className="contract-payment-copy">{paymentTerms}</p>
                <div className="contract-payment-amounts">
                  <div className="contract-payment-amount"><span>{paymentReceivedLabel}:</span><strong>{formatCurrency(downPayment)}</strong></div>
                  <div className="contract-payment-amount"><span>{balanceLabel}:</span><strong>{formatCurrency(Math.max(totalAmount - downPayment, 0))}</strong></div>
                </div>
                {agreedPaymentDate && (
                  <div className="contract-agreed-payment-date">
                    <span>Agreed Payment Date (optional):</span> {agreedPaymentDate}
                  </div>
                )}
              </div>

              <div className="contract-warranty-card">
                <ShieldCheck size={22} strokeWidth={2} aria-hidden="true" />
                <div>
                  <h2 className="contract-section-title">Warranty</h2>
                  <p>
                    {isPerProductWarranty ? (
                      <><strong>Product-specific warranty coverage:</strong> Warranty periods and start/end dates are listed with each product above. Coverage begins on the listed start date.</>
                    ) : isNoWarranty ? (
                      <><strong>No Warranty:</strong> This project does not include warranty coverage.</>
                    ) : (
                      <><strong>{warrantyPeriod}-Day Warranty:</strong> ACGC Glass &amp; Aluminum Services provides a {warrantyPeriod}-day warranty on installed products and workmanship starting from the installation date.</>
                    )}
                  </p>
                </div>
              </div>
            </section>

            <div className="contract-downpayment-alert">
              <TriangleAlert size={16} strokeWidth={2.5} aria-hidden="true" />
              <span>{isFullPaymentMethod ? "Full payment" : `A downpayment of ${formatCurrency(downPayment)}`} is required to start the project based on the stated policy.</span>
            </div>

            <section className="contract-section contract-acknowledgment-section">
              <h2 className="contract-section-title">Client Acknowledgment</h2>
              {isAccepted ? (
                <div className="contract-signature-grid contract-signed-grid">
                  <div className="contract-signature-block">
                    <p className="contract-signature-line">Electronically Signed by: {contractData.acceptedBy || customerName}</p>
                    <p className="contract-signature-name">&#10003; Electronically Signed</p>
                    <p className="contract-signature-date">Date: {contractData.acceptanceDate || formatDate(new Date())}</p>
                  </div>
                  <div className="contract-accepted-note">Admin Note: This contract is officially issued by ACGC Glass &amp; Aluminum Services. Signature is implicit upon customer acceptance.</div>
                </div>
              ) : (
                <div className="contract-signature-grid">
                  <div className="contract-signature-block">
                    <div className="contract-signature-line" aria-hidden="true" />
                    <p className="contract-signature-caption">ACGC Representative</p>
                    <p className="contract-signature-name">Prepared by ACGC Glass &amp; Aluminum Services</p>
                  </div>
                  <div className="contract-signature-block">
                    <div className="contract-signature-line" aria-hidden="true" />
                    <p className="contract-signature-caption">Client Signature &amp; Printed Name</p>
                    <p className="contract-signature-name">{customerName}</p>
                    <p className="contract-signature-date">Date: __________________</p>
                  </div>
                </div>
              )}
            </section>

            <section className="contract-section contract-policy-section">
              <h2 className="contract-section-title">Contracts, Terms, Cancellation &amp; Warranty Policies</h2>
              <div className="contract-policy-grid">
                <article className="contract-policy-card">
                  <div className="contract-policy-heading"><span>1.</span><h3>Non-Refundable Downpayment.</h3></div>
                  <p>Once a downpayment has been made, it is strictly non-refundable and the order cannot be cancelled.</p>
                </article>
                <article className="contract-policy-card">
                  <div className="contract-policy-heading"><span>2.</span><h3>Material Turnover After Cancellation Request.</h3></div>
                  <p>If the customer insists on cancelling after paying the downpayment, no cash or monetary refund will be given. Only the materials already purchased for the order may be turned over to the customer.</p>
                </article>
                <article className="contract-policy-card">
                  <div className="contract-policy-heading"><span>3.</span><h3>Repairs Outside the Warranty Period.</h3></div>
                  <p>Service or repair requested after the warranty period has ended is subject to a service/repair fee. The applicable fee will be communicated before the repair work begins.</p>
                </article>
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}

export default ContractModal;
