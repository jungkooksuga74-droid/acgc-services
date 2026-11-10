import mongoose from "mongoose";
import Order from "../models/Order.js";
import RepairRequest from "../models/RepairRequest.js";
import User from "../models/User.js";
import { buildWarrantyCoverage } from "../services/warranty.js";
import { sendMail } from "../config/mailer.js";
import { ACTIVE_REPAIR_STATUSES } from "../utils/repairIdentity.js";

const text = (value, max = 4000) => String(value ?? "").trim().slice(0, max);
const normalizedRepairProductName = (value) => text(value, 200).replace(/\s+/g, " ").toLocaleLowerCase();
const money = (value, label = "Amount") => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw Object.assign(new Error(`${label} must be zero or more.`), { status: 400 });
  return Math.round(result * 100) / 100;
};
const statusError = (message, status = 409) => Object.assign(new Error(message), { status });
const repairStatusLabel = (status) => ({ pending_review: "Pending Review", quotation_pending_approval: "Awaiting Customer Decision", quotation_declined: "Quotation Declined", customer_accepted: "Quotation Accepted", admin_approved: "Warranty Approved", scheduled: "Scheduled", in_progress: "In Progress", completed: "Completed", cancelled: "Closed", rejected: "Rejected" }[status] || status || "Unknown");
const activeRepairConflict = async ({ customer, order, productIndex, excludeId } = {}) => {
  if (!customer || !order || !Number.isInteger(Number(productIndex))) return null;
  const filter = { customer, order, productIndex: Number(productIndex), status: { $in: ACTIVE_REPAIR_STATUSES } };
  if (excludeId) filter._id = { $ne: excludeId };
  return RepairRequest.findOne(filter).sort({ createdAt: 1, _id: 1 });
};
const sendActiveRepairConflict = (res, repair, admin = false) => res.status(409).json({
  success: false,
  code: "ACTIVE_REPAIR_EXISTS",
  message: `An active repair ticket already exists for this product and project. Ticket ${repair.repairTrackingId || "pending"} is ${repairStatusLabel(repair.status)}. Please wait until it is completed or closed before creating another request.`,
  existingRepair: admin ? publicAdmin(repair) : publicCustomer(repair),
});
const isDuplicateRepairKeyError = (error) => error?.code === 11000 && (error?.keyPattern?.activeRepairKey || error?.message?.includes("unique_active_repair_per_project_item"));
const event = (repair, name, detail, actor) => repair.history.push({ event: name, detail: text(detail), actor: actor?.id || null, actorRole: actor?.role || "system" });
const repairTotal = (repair) => Math.round(Math.max(0, Number(repair.quotation?.total) || 0) * 100) / 100;
const parsePaymentDate = (value) => {
  const dateKey = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw statusError("Enter the date the payment was received.", 400);
  const parsed = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) throw statusError("Enter a valid payment date.", 400);
  const manilaTodayParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const manilaToday = Object.fromEntries(manilaTodayParts.map(({ type, value }) => [type, value]));
  const todayKey = `${manilaToday.year}-${manilaToday.month}-${manilaToday.day}`;
  if (dateKey > todayKey) throw statusError("Payment date cannot be in the future.", 400);
  return parsed;
};
const paymentMethodNeedsReference = (method) => ["bank transfer", "gcash", "online payment"].includes(text(method, 80).toLowerCase());
const verifiedRepairAmount = (repair) => {
  const stored = Number(repair.payment?.verifiedAmount);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored * 100) / 100;
  const recordsTotal = (repair.payment?.records || []).reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
  if (recordsTotal > 0) return Math.round(recordsTotal * 100) / 100;
  if (repair.payment?.proofReviewStatus === "approved" && repair.payment?.status === "received") return Math.round((Number(repair.payment.proofAmount) || Number(repair.completion?.amountPaid) || 0) * 100) / 100;
  return 0;
};
const updateVerifiedPayment = (repair, actor, { amount, paymentDate, method, reference = "", source = "admin_recorded", proofUrl = "" }) => {
  const total = repairTotal(repair);
  const previous = verifiedRepairAmount(repair);
  const next = Math.round((previous + amount) * 100) / 100;
  const remaining = Math.max(0, Math.round((total - next) * 100) / 100);
  if (amount <= 0) throw statusError("Payment amount must be greater than zero.", 400);
  if (amount > Math.max(0, Math.round((total - previous) * 100) / 100)) throw statusError("Payment amount exceeds the remaining repair balance.", 400);
  const verifiedAt = new Date();
  repair.payment.records = [...(repair.payment.records || []), { id: new mongoose.Types.ObjectId().toString(), amount, paymentDate, method: text(method, 80), reference: text(reference, 180), source, proofUrl: text(proofUrl, 1200), verifiedAt, verifiedBy: actor.id || null, verifiedByRole: actor.role || "admin" }];
  repair.payment.verifiedAmount = next;
  repair.payment.method = text(method, 80);
  repair.payment.status = remaining === 0 ? "paid" : next > 0 ? "partial" : "pending";
  repair.payment.receivedAt = next > 0 ? verifiedAt : null;
  repair.payment.verifiedAt = remaining === 0 ? verifiedAt : repair.payment.verifiedAt || null;
  repair.payment.verifiedBy = remaining === 0 ? actor.id || null : repair.payment.verifiedBy || null;
  repair.payment.verifiedByRole = remaining === 0 ? actor.role || "admin" : repair.payment.verifiedByRole || "";
  return { total, paid: next, remaining, fullyPaid: remaining === 0, verifiedAt };
};
const isFullyPaidRepair = (repair) => {
  if (repair.workflowType !== "paid" || verifiedRepairAmount(repair) < repairTotal(repair)) return false;
  const completeVerifiedRecords = (repair.payment?.records || []).filter((record) => Number(record.amount) > 0 && record.paymentDate && record.method && record.verifiedAt && record.verifiedBy);
  const recordsTotal = completeVerifiedRecords.reduce((sum, record) => sum + Number(record.amount), 0);
  const currentVerification = repair.payment?.status === "paid" && recordsTotal >= repairTotal(repair) && Boolean(repair.payment?.verifiedAt && repair.payment?.verifiedBy);
  const legacyAdminVerification = repair.payment?.status === "received" && repair.payment?.proofReviewStatus === "approved"
    && Boolean(repair.payment?.proofReviewedAt)
    && (repair.history || []).some((entry) => entry.event === "payment_proof_approved" && entry.actor);
  return currentVerification || legacyAdminVerification;
};
const publicCustomer = (repair) => ({
  _id: repair._id, repairTrackingId: repair.repairTrackingId, order: repair.order, orderTracking: repair.orderTracking, productName: repair.productName,
  customerName: repair.customerName, customerEmail: repair.customerEmail, customerPhone: repair.customerPhone, siteAddress: repair.siteAddress || "",
  issueDescription: repair.issueDescription, mediaUrls: repair.mediaUrls, installationDate: repair.installationDate, workflowType: repair.workflowType,
  warranty: repair.warranty, status: repair.status, inspection: repair.inspection, quotation: repair.quotation,
  startedAt: repair.startedAt || null,
  payment: {
    method: repair.payment?.method || "", status: repair.payment?.status || "pending", receivedAt: repair.payment?.receivedAt || null,
    verifiedAmount: verifiedRepairAmount(repair), verifiedAt: repair.payment?.verifiedAt || null,
    proofUrl: repair.payment?.proofUrl || "", proofFileName: repair.payment?.proofFileName || "", proofAmount: repair.payment?.proofAmount ?? null,
    proofTransactionNumber: repair.payment?.proofTransactionNumber || "", proofSubmittedAt: repair.payment?.proofSubmittedAt || null,
    proofReviewedAt: repair.payment?.proofReviewedAt || null, proofReviewStatus: repair.payment?.proofReviewStatus || "none",
    proofRejectionReason: repair.payment?.proofRejectionReason || "",
    records: (repair.payment?.records || []).map(({ amount, paymentDate, method, reference, source, verifiedAt }) => ({ amount, paymentDate, method, reference, source, verifiedAt })),
  },
  schedule: repair.schedule, completion: repair.completion, invoiceNumber: repair.invoiceNumber,
  receipt: repair.receipt?.number ? { number: repair.receipt.number, issuedAt: repair.receipt.issuedAt, amountPaidAtIssue: repair.receipt.amountPaidAtIssue } : null,
  quotationHistory: repair.quotationHistory || [], history: repair.history, requestedAt: repair.createdAt, updatedAt: repair.updatedAt,
});
const publicAdmin = (repair) => repair.toObject ? repair.toObject() : repair;
const getRepair = async (id) => mongoose.Types.ObjectId.isValid(id) ? RepairRequest.findById(id) : null;
const quoteCustomer = async (repair, subject, message) => {
  if (!repair.customerEmail) return;
  try { await sendMail({ from: process.env.EMAIL_FROM || "ACGC Services <no-reply@acgc.com>", to: repair.customerEmail, subject, text: message }); }
  catch (error) { console.error("Repair notification failed:", error); }
};
const notifyAdmin = async (subject, message) => {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  try { await sendMail({ from: process.env.EMAIL_FROM || "ACGC Services <no-reply@acgc.com>", to, subject, text: message }); }
  catch (error) { console.error("Repair admin notification failed:", error); }
};

const warrantyForItem = (order, item, now = new Date()) => {
  const period = item?.warranty_period || order.warranty_period;
  const start = item?.warranty_start_date || order.warranty_start_date || order.createdAt;
  let expiry = item?.warranty_expiry_date || (order.items?.length === 1 ? order.warranty_expiry_date : null) || null;
  if (!expiry && period) expiry = buildWarrantyCoverage(start, period, item?.custom_warranty_days || order.custom_warranty_days, now)?.warranty_expiry_date || null;
  const status = String(item?.warranty_status || (order.items?.length === 1 ? order.warranty_status : "") || "").toLowerCase();
  const noWarranty = String(period || "").trim().toLowerCase() === "no warranty" || status === "no_warranty";
  const expiresAt = expiry ? new Date(expiry) : null;
  const active = !noWarranty && (expiresAt ? expiresAt >= now : status === "active");
  const expired = !noWarranty && (expiresAt ? expiresAt < now : status === "expired");
  return {
    status: noWarranty ? "no_warranty" : active ? "active" : expired ? "expired" : "unknown",
    startsAt: start ? new Date(start) : null,
    expiresAt,
  };
};

const redactStaffPaymentAmounts = (value) => {
  if (Array.isArray(value)) return value.map(redactStaffPaymentAmounts);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /(amount|price|cost|balance|charge|subtotal|total|rate)/i.test(key) ? null : redactStaffPaymentAmounts(item),
  ]));
};

export const listCompletedRepairProjects = async (req, res) => {
  const orders = await Order.find({ customer: req.user?.id, status: "completed" })
    .select("tracking items createdAt updatedAt warranty_period custom_warranty_days warranty_status warranty_start_date warranty_expiry_date")
    .sort({ updatedAt: -1 }).limit(500).lean();
  res.json({ success: true, projects: orders.map((order) => ({ _id: order._id, tracking: order.tracking, items: order.items, completedAt: order.updatedAt || order.createdAt })) });
};

export const listRepairRequests = async (req, res) => {
  const filter = { workflowVersion: 2 };
  if (["warranty", "paid"].includes(req.query.type)) filter.workflowType = req.query.type;
  if (["pending_review", "quotation_pending_approval", "quotation_declined", "customer_accepted", "admin_approved", "scheduled", "in_progress", "completed", "cancelled", "rejected"].includes(req.query.status)) filter.status = req.query.status;
  const repairs = await RepairRequest.find(filter).sort({ updatedAt: -1 }).limit(1000);
  const repairRecords = await Promise.all(repairs.map(async (repair) => {
    if (!repair.repairTrackingId) await repair.save();
    return repair.toObject();
  }));
  const orderIds = [...new Set(repairRecords.map((repair) => String(repair.order || "")).filter(Boolean))];
  const customerIds = [...new Set(repairRecords.map((repair) => String(repair.customer || "")).filter(Boolean))];
  const [orders, customers] = await Promise.all([
    orderIds.length ? Order.find({ _id: { $in: orderIds } }).select("_id shipping_address").lean() : [],
    customerIds.length ? User.find({ _id: { $in: customerIds } }).select("_id street_address city province zip_code").lean() : [],
  ]);
  const orderAddresses = new Map(orders.map((order) => [String(order._id), String(order.shipping_address || "").trim()]));
  const customerAddresses = new Map(customers.map((customer) => [String(customer._id), [customer.street_address, customer.city, customer.province, customer.zip_code].filter(Boolean).join(", ")]));
  for (const repair of repairRecords) {
    repair.siteAddress = repair.siteAddress || orderAddresses.get(String(repair.order || "")) || customerAddresses.get(String(repair.customer || "")) || "";
  }
  res.json({ success: true, repairs: req.user?.role === "skilled_worker" && req.staffAccess?.hide_payment_amounts === true ? redactStaffPaymentAmounts(repairRecords) : repairRecords });
};

export const getAdminOrderRepairHistory = async (req, res) => {
  const orderId = String(req.params.orderId || "");
  if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ success: false, message: "A valid project is required." });
  const order = await Order.findById(orderId).select("_id customer tracking").lean();
  if (!order) return res.status(404).json({ success: false, message: "Project not found." });

  const repairFilter = {
    workflowVersion: 2,
    $or: [
      { order: order._id },
      ...(order.tracking && order.customer ? [{ orderTracking: order.tracking, customer: order.customer }] : []),
    ],
  };
  const repairs = await RepairRequest.find(repairFilter).sort({ createdAt: -1, _id: -1 }).lean();
  return res.json({ success: true, repairs: req.user?.role === "skilled_worker" && req.staffAccess?.hide_payment_amounts === true ? redactStaffPaymentAmounts(repairs) : repairs });
};

export const getAdminCustomerRepairProducts = async (req, res) => {
  const customerId = String(req.params.customerId || "");
  if (!mongoose.Types.ObjectId.isValid(customerId)) return res.status(400).json({ success: false, message: "Choose a valid customer account." });
  const customer = await User.findOne({ _id: customerId, role: "customer" }).select("first_name last_name email phone street_address city province zip_code").lean();
  if (!customer) return res.status(404).json({ success: false, message: "Customer account not found." });
  const orders = await Order.find({ customer: customer._id, status: "completed" })
    .select("tracking shipping_address items createdAt updatedAt estimated_installation_date warranty_period custom_warranty_days warranty_status warranty_start_date warranty_expiry_date")
    .sort({ updatedAt: -1 }).limit(500).lean();
  const products = orders.flatMap((order) => (order.items || []).map((item, productIndex) => ({
    orderId: order._id,
    productIndex,
    orderTracking: order.tracking || "",
    siteAddress: String(order.shipping_address || [customer.street_address, customer.city, customer.province, customer.zip_code].filter(Boolean).join(", ")).trim(),
    productName: text(item.name, 200) || "Ordered product",
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    measurementUnit: text(item.measurement_unit, 12) || "in",
    quantity: Number(item.quantity) || 1,
    installationDate: order.estimated_installation_date || item.warranty_start_date || order.warranty_start_date || null,
    completedAt: order.updatedAt || order.createdAt || null,
    warranty: warrantyForItem(order, item),
  })));
  res.json({ success: true, customer: { _id: customer._id, customerName: [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim(), customerEmail: customer.email || "", customerPhone: customer.phone || "", siteAddress: [customer.street_address, customer.city, customer.province, customer.zip_code].filter(Boolean).join(", ") }, products });
};

export const createAdminRepairRequest = async (req, res) => {
  const requestedCustomerId = String(req.body?.customerId || "");
  let customer = null;
  if (requestedCustomerId) {
    if (!mongoose.Types.ObjectId.isValid(requestedCustomerId)) return res.status(400).json({ success: false, message: "Choose a valid customer account." });
    customer = await User.findOne({ _id: requestedCustomerId, role: "customer" }).select("first_name last_name email phone street_address city province zip_code").lean();
    if (!customer) return res.status(404).json({ success: false, message: "Customer account not found." });
  }
  let orderId = String(req.body?.orderId || "");
  let productIndex = Number(req.body?.productIndex);
  let order = null;
  let orderItem = null;
  if (!orderId && customer && text(req.body?.orderTracking, 100) && text(req.body?.productName, 200)) {
    const referencedOrder = await Order.findOne({ customer: customer._id, tracking: text(req.body.orderTracking, 100), status: "completed" }).select("_id customer tracking items").lean();
    if (referencedOrder) {
      const normalizedName = normalizedRepairProductName(req.body.productName);
      const matchingIndexes = (referencedOrder.items || []).flatMap((item, index) => normalizedRepairProductName(item.name) === normalizedName ? [index] : []);
      if (matchingIndexes.length !== 1) return res.status(400).json({ success: false, message: matchingIndexes.length ? "This project contains multiple matching product rows. Select the exact product row from the customer account." : "The product name does not match the referenced customer project. Select the exact product from the customer account." });
      orderId = String(referencedOrder._id);
      productIndex = matchingIndexes[0];
    }
  }
  if (orderId || (req.body?.productIndex !== undefined && req.body?.productIndex !== "")) {
    if (!customer || !mongoose.Types.ObjectId.isValid(orderId) || req.body?.productIndex === undefined || req.body?.productIndex === "" || !Number.isInteger(productIndex) || productIndex < 0) return res.status(400).json({ success: false, message: "Choose a valid product from the selected customer account." });
    order = await Order.findOne({ _id: orderId, customer: customer._id, status: "completed" }).lean();
    orderItem = order?.items?.[productIndex];
    if (!order || !orderItem) return res.status(404).json({ success: false, message: "The selected product is not part of a completed order for this customer." });
  }
  if (customer && !order) {
    const activeForCustomer = await RepairRequest.findOne({ customer: customer._id, status: { $in: ACTIVE_REPAIR_STATUSES } }).sort({ createdAt: 1, _id: 1 });
    if (activeForCustomer) return res.status(409).json({
      success: false,
      code: "ACTIVE_REPAIR_REQUIRES_PRODUCT",
      message: "This customer has an active repair ticket. Select the exact project and product row so the system can verify that this is a different item.",
      existingRepair: publicAdmin(activeForCustomer),
    });
  }
  const customerName = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() : text(req.body?.customerName, 180);
  const customerEmail = customer ? String(customer.email || "").trim().toLowerCase() : text(req.body?.customerEmail, 180).toLowerCase();
  const customerPhone = customer ? customer.phone || "" : text(req.body?.customerPhone, 80);
  const productName = orderItem ? text(orderItem.name, 200) || "Ordered product" : text(req.body?.productName, 200);
  const issueDescription = text(req.body?.issueDescription);
  const warranty = order && orderItem ? warrantyForItem(order, orderItem) : { status: req.body?.workflowType === "warranty" ? "unknown" : "no_warranty" };
  if (order && orderItem && warranty.status === "unknown") return res.status(409).json({ success: false, message: "The project's warranty end date could not be confirmed. Update its warranty details before creating a repair ticket." });
  const workflowType = order && orderItem ? ["expired", "no_warranty"].includes(warranty.status) ? "paid" : "warranty" : req.body?.workflowType === "warranty" ? "warranty" : "paid";
  if (!customerName || !productName || !issueDescription) return res.status(400).json({ success: false, message: "Enter the customer name, product or service, and repair issue." });
  const existing = await activeRepairConflict({ customer: customer?._id, order: order?._id, productIndex });
  if (existing) return sendActiveRepairConflict(res, existing, true);
  try {
  const repair = await RepairRequest.create({
    customerName, customerEmail, customerPhone,
    siteAddress: order?.shipping_address || (customer ? [customer.street_address, customer.city, customer.province, customer.zip_code].filter(Boolean).join(", ") : ""),
    productName, issueDescription,
    installationDate: order ? order.estimated_installation_date || orderItem.warranty_start_date || order.warranty_start_date || null : null,
    customer: customer?._id || null,
    order: order?._id || null,
    productIndex: order ? productIndex : 0,
    orderTracking: order ? order.tracking || "" : text(req.body?.orderTracking, 100) || "Admin entry",
    workflowType, createdByAdmin: true, status: "pending_review",
    warranty,
    mediaUrls: Array.isArray(req.body?.mediaUrls) ? req.body.mediaUrls.slice(0, 6).map((url) => text(url, 1200)).filter((url) => /^https:\/\//i.test(url)) : [],
    history: [{ event: "pending_review", detail: "Repair ticket created manually by an administrator.", actor: req.user.id, actorRole: req.user.role || "admin" }],
  });
  res.status(201).json({ success: true, repair: publicAdmin(repair) });
  } catch (error) {
    if (isDuplicateRepairKeyError(error)) {
      const conflict = await activeRepairConflict({ customer: customer?._id, order: order?._id, productIndex });
      if (conflict) return sendActiveRepairConflict(res, conflict, true);
    }
    throw error;
  }
};

export const listCustomerRepairRequests = async (req, res) => {
  const repairs = await RepairRequest.find({ customer: req.user.id, workflowVersion: 2 }).sort({ updatedAt: -1 });
  const customerRepairs = await Promise.all(repairs.map(async (repair) => {
    if (!repair.repairTrackingId) await repair.save();
    return publicCustomer(repair);
  }));
  res.json({ success: true, repairs: customerRepairs });
};

export const trackRepairRequest = async (req, res) => {
  const repairTrackingId = String(req.params.repairTrackingId || "").trim().toUpperCase();
  if (!/^RPR-(?:\d{6}-[A-F0-9]{8}|\d{8}-[A-F0-9]{10})$/.test(repairTrackingId)) {
    return res.status(400).json({ success: false, message: "Enter a valid repair request ID." });
  }
  const repair = await RepairRequest.findOne({ repairTrackingId })
    .select("repairTrackingId productName issueDescription workflowType warranty.status warranty.expiresAt status schedule createdAt updatedAt completion.completedAt")
    .lean();
  if (!repair) return res.status(404).json({ success: false, message: "No repair request was found with that ID." });
  return res.json({
    success: true,
    repair: {
      _id: repair._id,
      repairTrackingId: repair.repairTrackingId,
      productName: repair.productName,
      issueDescription: repair.issueDescription,
      workflowType: repair.workflowType,
      warranty: repair.warranty,
      status: repair.status,
      schedule: repair.schedule,
      requestedAt: repair.createdAt,
      updatedAt: repair.updatedAt,
      completedAt: repair.completion?.completedAt || null,
    },
  });
};

export const createCustomerRepairRequest = async (req, res) => {
  const orderId = String(req.body?.orderId || req.body?.projectId || "");
  const productIndex = Number(req.body?.productIndex);
  const issueDescription = text(req.body?.issueDescription);
  if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(400).json({ success: false, message: "Choose a completed order." });
  if (!Number.isInteger(productIndex) || productIndex < 0) return res.status(400).json({ success: false, message: "Choose a product on the order." });
  if (!issueDescription) return res.status(400).json({ success: false, message: "Describe the repair issue." });
  const order = await Order.findOne({ _id: orderId, customer: req.user.id, status: "completed" }).lean();
  const item = order?.items?.[productIndex];
  if (!order || !item) return res.status(404).json({ success: false, message: "Completed order or product not found in your account." });
  const warranty = warrantyForItem(order, item);
  if (warranty.status === "unknown") return res.status(409).json({ success: false, message: "We could not confirm this project's warranty end date. Please contact ACGC to verify coverage before submitting a repair request." });
  const workflowType = ["expired", "no_warranty"].includes(warranty.status) ? "paid" : "warranty";
  const requestedWorkflowType = String(req.body?.workflowType || "").trim().toLowerCase();
  if (requestedWorkflowType && !["warranty", "paid"].includes(requestedWorkflowType)) return res.status(400).json({ success: false, message: "Choose a valid repair request type." });
  if (requestedWorkflowType && requestedWorkflowType !== workflowType) return res.status(409).json({ success: false, message: workflowType === "paid" ? "This project is outside warranty coverage. Submit it as an out-of-warranty repair request." : "This project is still covered by warranty. Submit it as a warranty claim." });
  if (workflowType === "paid" && req.body?.outOfWarrantyAcknowledged !== true) return res.status(400).json({ success: false, message: "Confirm that this paid repair is subject to inspection and quotation before filing." });
  const mediaUrls = Array.isArray(req.body?.mediaUrls) ? req.body.mediaUrls.slice(0, 6).map((url) => text(url, 1200)).filter((url) => /^https:\/\//i.test(url)) : [];
  const account = await User.findById(req.user.id).select("first_name last_name email phone street_address city province zip_code").lean();
  if (!account) return res.status(404).json({ success: false, message: "Customer account not found." });
  const existing = await activeRepairConflict({ customer: req.user.id, order: order._id, productIndex });
  if (existing) return sendActiveRepairConflict(res, existing);
  const customerName = [account.first_name, account.last_name].filter(Boolean).join(" ").trim();
  let repair;
  try {
  repair = await RepairRequest.create({
    order: order._id, productIndex, customer: req.user.id, customerName,
    customerEmail: String(account.email || "").trim().toLowerCase(), customerPhone: account.phone || "",
    siteAddress: order.shipping_address || [account.street_address, account.city, account.province, account.zip_code].filter(Boolean).join(", "),
    orderTracking: order.tracking || "", productName: text(item.name, 200) || "Ordered product", issueDescription,
    mediaUrls, workflowType, warranty, status: "pending_review",
    history: [{ event: "pending_review", detail: `Customer filed a ${workflowType === "warranty" ? "warranty claim" : "paid repair request"} for completed order ${order.tracking || ""}.`, actor: req.user.id, actorRole: "customer" }],
  });
  } catch (error) {
    if (isDuplicateRepairKeyError(error)) {
      const conflict = await activeRepairConflict({ customer: req.user.id, order: order._id, productIndex });
      if (conflict) return sendActiveRepairConflict(res, conflict);
    }
    throw error;
  }
  void notifyAdmin(`New ${workflowType === "warranty" ? "warranty claim" : "paid repair request"}: ${repair.productName}`, `${customerName} filed a repair request for ${repair.productName}. Order ${repair.orderTracking}. Issue: ${issueDescription}`);
  res.status(201).json({ success: true, repair: publicCustomer(repair) });
};

export const reviewWarrantyClaim = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.workflowType !== "warranty" || repair.status !== "pending_review") return res.status(409).json({ success: false, message: "Only a pending warranty claim can be approved here." });
  const order = repair.createdByAdmin ? null : await Order.findById(repair.order).lean();
  const currentWarranty = repair.createdByAdmin ? { status: "active" } : order?.items?.[repair.productIndex] ? warrantyForItem(order, order.items[repair.productIndex]) : { status: "unknown" };
  if (currentWarranty.status === "unknown") return res.status(409).json({ success: false, message: "The warranty end date could not be confirmed. Update the project warranty details before processing this claim." });
  if (["expired", "no_warranty"].includes(currentWarranty.status)) {
    repair.workflowType = "paid";
    repair.warranty.status = currentWarranty.status;
    repair.warranty.expiresAt = currentWarranty.expiresAt || repair.warranty.expiresAt;
    await repair.save();
    return res.status(409).json({ success: false, message: "The warranty is no longer active. This claim was switched to a paid repair; issue a quotation." });
  }
  const notes = text(req.body?.inspectionNotes);
  const reason = text(req.body?.decisionReason, 1200);
  if (notes.length < 15) return res.status(400).json({ success: false, message: "Add detailed inspection findings." });
  repair.inspection = { notes, inspectedAt: new Date(), inspectedBy: req.user.id };
  repair.warranty.decisionReason = reason;
  if (repair.createdByAdmin) repair.warranty.status = "active";
  repair.status = "admin_approved";
  repair.payment.status = "not_required";
  event(repair, "admin_approved", `Warranty claim approved at no charge.${reason ? ` ${reason}` : ""}`, req.user);
  await repair.save();
  void quoteCustomer(repair, `Warranty claim approved: ${repair.productName}`, `Your warranty repair claim is approved. ACGC will contact you to schedule a service visit. ${notes}`);
  res.json({ success: true, repair: publicAdmin(repair) });
};

export const rejectWarrantyClaim = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.workflowType !== "warranty" || repair.status !== "pending_review") return res.status(409).json({ success: false, message: "Only a pending warranty claim can be rejected here." });
  const notes = text(req.body?.inspectionNotes);
  const reason = text(req.body?.decisionReason, 1200);
  if (notes.length < 15 || reason.length < 10) return res.status(400).json({ success: false, message: "Add detailed inspection findings and a specific reason for rejecting the claim." });
  repair.inspection = { notes, inspectedAt: new Date(), inspectedBy: req.user.id };
  repair.warranty.decisionReason = reason;
  repair.status = "rejected";
  event(repair, "rejected", `Warranty repair request rejected. Reason: ${reason}`, req.user);
  await repair.save();
  void quoteCustomer(repair, `Warranty repair request rejected: ${repair.productName}`, `Your warranty repair request for ${repair.productName} (order ${repair.orderTracking}) was rejected after inspection. Reason: ${reason}. Inspection findings: ${notes}`);
  res.json({ success: true, repair: publicAdmin(repair) });
};

export const issueRepairQuotation = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (!(["pending_review", "quotation_pending_approval", "quotation_declined"].includes(repair.status))) return res.status(409).json({ success: false, message: "This repair can no longer be quoted." });
  if (repair.status === "quotation_pending_approval") {
    // A client may retry after the first request committed but its response was lost.
    // Treat an identical retry as success without issuing a second quote or email.
    const requestedParts = Array.isArray(req.body?.parts) ? req.body.parts.slice(0, 50)
      .map((part) => ({ description: text(part?.description, 180), cost: Number(part?.cost) }))
      .filter((part) => part.description) : [];
    const storedParts = repair.quotation?.parts || [];
    const sameParts = requestedParts.length === storedParts.length
      && requestedParts.every((part, index) => part.description === storedParts[index]?.description
        && Number.isFinite(part.cost) && Math.round(part.cost * 100) / 100 === Number(storedParts[index]?.cost));
    const requestedLabor = Number(req.body?.laborCost ?? 0);
    const sameQuote = sameParts
      && Number.isFinite(requestedLabor)
      && Math.round(requestedLabor * 100) / 100 === Number(repair.quotation?.laborCost || 0)
      && text(req.body?.quotationNotes, 2000) === (repair.quotation?.notes || "")
      && text(req.body?.inspectionNotes) === (repair.inspection?.notes || "")
      && (req.body?.voidWarranty !== true || (repair.warranty?.issueExcluded === true
        && text(req.body?.decisionReason, 1200) === (repair.warranty?.decisionReason || "")));
    if (sameQuote) return res.json({ success: true, alreadyIssued: true, repair: publicAdmin(repair) });
    return res.status(409).json({ success: false, message: "A quotation is already awaiting the customer's decision. The existing quotation was kept unchanged." });
  }
  const override = req.body?.voidWarranty === true;
  if (repair.workflowType === "warranty" && !override) return res.status(409).json({ success: false, message: "Approve a covered claim or void its warranty before issuing a paid quotation." });
  const notes = text(req.body?.inspectionNotes);
  const decisionReason = text(req.body?.decisionReason, 1200);
  if (notes.length < 15 || (override && decisionReason.length < 10)) return res.status(400).json({ success: false, message: "Add detailed inspection findings and a specific warranty exclusion reason." });
  if (!repair.customer) return res.status(409).json({ success: false, message: "Link this repair ticket to the customer's account before issuing a quotation." });
  const parts = Array.isArray(req.body?.parts) ? req.body.parts.slice(0, 50).map((part) => ({ description: text(part?.description, 180), cost: money(part?.cost, "Part cost") })).filter((part) => part.description) : [];
  const laborCost = money(req.body?.laborCost ?? 0, "Labor fee");
  if (!parts.length && laborCost <= 0) return res.status(400).json({ success: false, message: "Add at least one part or a labor fee to the quotation." });
  const total = money(parts.reduce((sum, part) => sum + part.cost, 0) + laborCost, "Quotation total");
  if (override) {
    repair.workflowType = "paid";
    repair.warranty.issueExcluded = true;
    repair.warranty.decisionReason = decisionReason;
    repair.warranty.issueExcludedAt = new Date();
    repair.warranty.issueExcludedBy = req.user.id;
  }
  const evidenceUrls = Array.isArray(req.body?.evidenceUrls) ? req.body.evidenceUrls.slice(0, 10).map((url) => text(url, 1200)).filter((url) => /^https:\/\//i.test(url)) : repair.inspection?.evidenceUrls || [];
  repair.inspection = { notes, evidenceUrls, inspectedAt: new Date(), inspectedBy: req.user.id };
  if (repair.quotation?.issuedAt) repair.quotationHistory.push({ ...(repair.quotation.toObject ? repair.quotation.toObject() : repair.quotation), archivedAt: new Date() });
  repair.quotation = { parts, laborCost, total, notes: text(req.body?.quotationNotes, 2000), issuedAt: new Date(), expiresAt: new Date(Date.now() + 14 * 86400000), customerDecisionAt: null };
  repair.status = "quotation_pending_approval";
  repair.payment = { method: "", status: "pending", receivedAt: null };
  event(repair, "quotation_issued", `Quotation issued for PHP ${total.toFixed(2)}. Parts: ${parts.map((part) => `${part.description} PHP ${part.cost.toFixed(2)}`).join(", ") || "none"}; labor PHP ${laborCost.toFixed(2)}.${override ? ` Warranty exclusion for this repair issue only: ${decisionReason}` : ""} Awaiting the customer's decision.`, req.user);
  await repair.save();
  void quoteCustomer(repair, `Repair quotation ready: ${repair.productName}`, `Your repair request has been inspected. ${override ? `Based on our inspection findings, this damage is not covered by the product warranty for this repair issue. Reason: ${decisionReason}. ` : ""}Inspection findings: ${notes}. A paid repair quotation for PHP ${total.toFixed(2)} is available in your customer dashboard. You may accept or decline the proposed repair.`);
  res.json({ success: true, repair: publicAdmin(repair) });
};

export const respondToQuotation = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair || String(repair.customer) !== String(req.user.id)) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.status !== "quotation_pending_approval" || !repair.quotation.issuedAt) return res.status(409).json({ success: false, message: "This repair has no pending quotation." });
  if (repair.quotation.expiresAt && repair.quotation.expiresAt < new Date()) return res.status(409).json({ success: false, message: "This quotation expired. Contact ACGC for a revised quotation." });
  const action = req.body?.action;
  if (action === "decline") {
    repair.status = "quotation_declined";
    repair.quotation.customerDecisionAt = new Date();
    event(repair, "quotation_declined", "Customer declined the quotation; no paid repair work will proceed. Ticket and inspection history preserved.", req.user);
  } else if (action === "accept") {
    repair.status = "customer_accepted";
    repair.quotation.customerDecisionAt = new Date();
    event(repair, "customer_accepted", `Customer accepted the repair quotation of PHP ${repair.quotation.total.toFixed(2)}.`, req.user);
  } else return res.status(400).json({ success: false, message: "Choose accept or decline." });
  await repair.save();
  void quoteCustomer(repair, `Quotation ${action === "accept" ? "accepted" : "declined"}: ${repair.productName}`, `${repair.customerName} ${action === "accept" ? "accepted" : "declined"} the repair quotation for ${repair.productName}.`);
  void notifyAdmin(`Customer ${action === "accept" ? "accepted" : "declined"} repair quotation: ${repair.productName}`, `${repair.customerName} ${action === "accept" ? "accepted" : "declined"} the quotation for ticket ${repair.repairTrackingId}. ${action === "accept" ? `The quoted amount is PHP ${repair.quotation.total.toFixed(2)}. You may schedule the repair.` : "No paid repair work should be scheduled. The ticket and inspection history remain available."}`);
  res.json({ success: true, repair: publicCustomer(repair) });
};

export const submitRepairPaymentProof = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair || String(repair.customer) !== String(req.user.id)) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.workflowType !== "paid" || !["customer_accepted", "scheduled", "in_progress", "completed"].includes(repair.status)) {
    return res.status(409).json({ success: false, message: "Accept the repair quotation before submitting payment proof." });
  }
  if (repair.payment.status === "paid" || isFullyPaidRepair(repair)) return res.status(409).json({ success: false, message: "This repair has already been verified as fully paid." });
  if (repair.payment.proofReviewStatus === "pending") return res.status(409).json({ success: false, message: "Your payment proof is awaiting review." });

  const proofUrl = text(req.body?.proofUrl, 1200);
  const proofFileName = text(req.body?.proofFileName, 255);
  const transactionNumber = text(req.body?.transactionNumber, 180);
  let amount;
  try { amount = money(req.body?.amount, "Payment amount"); }
  catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }
  if (proofUrl || proofFileName) {
    try {
      const parsed = new URL(proofUrl);
      const isCloudinaryProof = parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com" && parsed.pathname.includes("/acgc/payment-proofs/");
      const isLocalUploadedProof = parsed.origin === `${req.protocol}://${req.get("host")}` && /^\/uploads\/[\w-]+\.(jpe?g|png|webp|gif|pdf)$/i.test(parsed.pathname);
      if (!isCloudinaryProof && !isLocalUploadedProof) throw new Error("Invalid proof URL");
    } catch {
      return res.status(400).json({ success: false, message: "Upload a valid payment proof using the payment uploader, or leave the optional file empty." });
    }
    if (!proofFileName) return res.status(400).json({ success: false, message: "Payment proof filename is required when a file is attached." });
  }
  const remaining = Math.max(0, Math.round((repairTotal(repair) - verifiedRepairAmount(repair)) * 100) / 100);
  if (amount <= 0 || amount > remaining) return res.status(400).json({ success: false, message: `Enter an amount greater than zero and no more than the remaining balance of PHP ${remaining.toFixed(2)}.` });
  if (transactionNumber && repair.payment.records?.some((record) => String(record.reference || "").trim() === transactionNumber)) return res.status(409).json({ success: false, message: "This transaction reference has already been recorded." });
  if (proofUrl && repair.payment.records?.some((record) => record.proofUrl && record.proofUrl === proofUrl)) return res.status(409).json({ success: false, message: "This payment proof has already been verified." });

  repair.payment.proofUrl = proofUrl;
  repair.payment.proofFileName = proofFileName;
  repair.payment.proofAmount = amount;
  repair.payment.proofTransactionNumber = transactionNumber;
  repair.payment.proofSubmittedAt = new Date();
  repair.payment.proofReviewedAt = null;
  repair.payment.proofReviewStatus = "pending";
  repair.payment.proofRejectionReason = "";
  repair.payment.status = verifiedRepairAmount(repair) > 0 ? "partial" : "pending";
  event(repair, "payment_proof_submitted", `Customer submitted payment details for PHP ${amount.toFixed(2)}${transactionNumber ? `, reference ${transactionNumber}` : ""}${proofUrl ? " with payment proof attached" : " without an attached payment proof"}.`, req.user);
  await repair.save();
  void notifyAdmin(`Repair payment submitted: ${repair.productName}`, `${repair.customerName} submitted payment details for repair ${repair.orderTracking}${proofUrl ? " with an attached payment proof" : " without an attached payment proof"}. Review the payment in the repair management queue.`);
  res.json({ success: true, repair: publicCustomer(repair) });
};

export const reviewRepairPaymentProof = async (req, res) => {
  if (!["admin", "super_admin", "skilled_worker"].includes(req.user?.role)) return res.status(403).json({ success: false, message: "Only an administrator can verify repair payment proof." });
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.workflowType !== "paid" || repair.status === "quotation_declined" || repair.payment.proofReviewStatus !== "pending") return res.status(409).json({ success: false, message: "There is no payable repair proof to review for this ticket." });

  const action = req.body?.action;
  if (action === "approve") {
    let proofAmount;
    try { proofAmount = money(req.body?.amount ?? repair.payment.proofAmount, "Verified payment amount"); }
    catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }
    if (req.body?.confirmed !== true) return res.status(400).json({ success: false, message: "Confirm that the payment was received and verified." });
    const outstanding = Math.max(0, Math.round((repairTotal(repair) - verifiedRepairAmount(repair)) * 100) / 100);
    if (proofAmount <= 0 || proofAmount > outstanding) return res.status(409).json({ success: false, message: "The submitted proof exceeds the remaining repair balance or has no payable amount." });
    if (proofAmount >= outstanding && req.body?.confirmFullyPaid !== true) return res.status(400).json({ success: false, code: "CONFIRM_FULL_PAYMENT", message: "Confirm that the repair has been fully paid before verifying this payment." });
    const method = text(req.body?.method, 80);
    if (!["Cash", "Bank transfer", "GCash", "Other", "Online payment"].includes(method)) return res.status(400).json({ success: false, message: "Choose a valid payment method." });
    const reference = text(req.body?.reference || repair.payment.proofTransactionNumber, 180);
    if (paymentMethodNeedsReference(method) && !reference) return res.status(400).json({ success: false, message: `Enter the transaction reference for ${method}.` });
    if (reference && repair.payment.records?.some((record) => String(record.reference || "").trim() === reference)) return res.status(409).json({ success: false, message: "This transaction reference has already been recorded." });
    let paymentDate;
    try { paymentDate = parsePaymentDate(req.body?.paymentDate); }
    catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }
    const result = updateVerifiedPayment(repair, req.user, { amount: proofAmount, paymentDate, method, reference, source: "customer_proof", proofUrl: repair.payment.proofUrl });
    repair.payment.proofReviewStatus = "approved";
    repair.payment.proofRejectionReason = "";
    repair.payment.proofReviewedAt = new Date();
    repair.payment.proofReviewedBy = req.user.id;
    event(repair, "payment_proof_approved", `Administrator verified PHP ${proofAmount.toFixed(2)} by ${method} received on ${paymentDate.toISOString().slice(0, 10)}${reference ? ` (reference ${reference})` : ""}. Verified total: PHP ${result.paid.toFixed(2)}; remaining balance: PHP ${result.remaining.toFixed(2)}.`, req.user);
  } else if (action === "reject") {
    const reason = text(req.body?.reason, 1200);
    if (!reason) return res.status(400).json({ success: false, message: "Provide a reason for rejecting this payment proof." });
    repair.payment.proofReviewStatus = "rejected";
    repair.payment.proofRejectionReason = reason;
    repair.payment.status = verifiedRepairAmount(repair) >= repairTotal(repair) ? "paid" : verifiedRepairAmount(repair) > 0 ? "partial" : "pending";
    repair.payment.proofReviewedAt = new Date();
    repair.payment.proofReviewedBy = req.user.id;
    event(repair, "payment_proof_rejected", `Payment proof rejected: ${reason}`, req.user);
  } else return res.status(400).json({ success: false, message: "Choose approve or reject." });

  await repair.save();
  const approved = action === "approve";
  void quoteCustomer(repair, `Repair payment proof ${approved ? "verified" : "needs correction"}: ${repair.productName}`, approved
    ? `Your payment proof for ${repair.productName} was verified. Verified amount: PHP ${Number(repair.payment.proofAmount || 0).toFixed(2)}. Amount paid: PHP ${verifiedRepairAmount(repair).toFixed(2)} of PHP ${repairTotal(repair).toFixed(2)}. Remaining balance: PHP ${Math.max(0, repairTotal(repair) - verifiedRepairAmount(repair)).toFixed(2)}. Payment status: ${repair.payment.status}.`
    : `Your payment proof for ${repair.productName} could not be verified. Reason: ${repair.payment.proofRejectionReason} Please submit a corrected proof in your Warranty & Repair Service page.`);
  res.json({ success: true, repair: publicAdmin(repair) });
};

export const recordRepairPayment = async (req, res) => {
  if (!["admin", "super_admin", "skilled_worker"].includes(req.user?.role)) return res.status(403).json({ success: false, message: "Administrator access is required to verify repair payments." });
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.workflowType !== "paid" || !repair.quotation?.issuedAt || !["customer_accepted", "scheduled", "in_progress", "completed"].includes(repair.status)) return res.status(409).json({ success: false, message: "Only customer-accepted paid repairs can receive payment." });
  const requestId = text(req.body?.requestId, 100);
  if (!requestId) return res.status(400).json({ success: false, message: "A payment request reference is required." });
  const existing = (repair.payment.records || []).find((record) => record.requestId === requestId);
  if (existing) return res.json({ success: true, duplicate: true, repair: publicAdmin(repair) });
  let amount;
  try { amount = money(req.body?.amount, "Payment amount"); }
  catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }
  const method = text(req.body?.method, 80);
  const reference = text(req.body?.reference, 180);
  if (!["Cash", "Bank transfer", "GCash", "Other", "Online payment"].includes(method)) return res.status(400).json({ success: false, message: "Choose a valid payment method." });
  if (req.body?.confirmed !== true) return res.status(400).json({ success: false, message: "Confirm that the payment was received and verified." });
  if (paymentMethodNeedsReference(method) && !reference) return res.status(400).json({ success: false, message: `Enter the transaction reference for ${method}.` });
  let paymentDate;
  try { paymentDate = parsePaymentDate(req.body?.paymentDate); }
  catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }
  if (reference && repair.payment.records?.some((record) => String(record.reference || "").trim() === reference)) return res.status(409).json({ success: false, message: "This transaction reference has already been recorded." });
  const remaining = Math.max(0, Math.round((repairTotal(repair) - verifiedRepairAmount(repair)) * 100) / 100);
  if (amount <= 0 || amount > remaining) return res.status(400).json({ success: false, message: `Enter an amount greater than zero and no more than the remaining balance of PHP ${remaining.toFixed(2)}.` });
  if (amount >= remaining && req.body?.confirmFullyPaid !== true) return res.status(400).json({ success: false, code: "CONFIRM_FULL_PAYMENT", message: "Confirm that the repair has been fully paid before verifying this payment." });
  try {
    const result = updateVerifiedPayment(repair, req.user, { amount, paymentDate, method, reference, source: "admin_recorded" });
    const record = repair.payment.records.at(-1);
    record.requestId = requestId;
    event(repair, "payment_verified", `Administrator verified PHP ${amount.toFixed(2)} by ${method} received on ${paymentDate.toISOString().slice(0, 10)}${reference ? ` (reference ${reference})` : ""}. Paid: PHP ${result.paid.toFixed(2)} of PHP ${result.total.toFixed(2)}; remaining: PHP ${result.remaining.toFixed(2)}.`, req.user);
    await repair.save();
    void quoteCustomer(repair, `Repair payment updated: ${repair.productName}`, `ACGC verified PHP ${amount.toFixed(2)} for repair ${repair.repairTrackingId}. Total paid: PHP ${result.paid.toFixed(2)} of PHP ${result.total.toFixed(2)}. Remaining balance: PHP ${result.remaining.toFixed(2)}. Payment status: ${repair.payment.status}.`);
    return res.json({ success: true, repair: publicAdmin(repair) });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message || "Unable to record repair payment." });
  }
};

export const generateRepairReceipt = async (req, res) => {
  if (!["admin", "super_admin", "skilled_worker"].includes(req.user?.role)) return res.status(403).json({ success: false, message: "Only an administrator can issue a repair receipt." });
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.status === "quotation_declined") return res.status(409).json({ success: false, message: "A declined quotation cannot receive a repair receipt." });
  const warrantyEligible = repair.workflowType === "warranty" && repair.status === "completed" && repair.payment?.status === "not_required";
  if (!warrantyEligible && !repair.receipt?.number && !isFullyPaidRepair(repair)) return res.status(409).json({ success: false, message: "Receipt generation is unavailable until complete admin-verified payment records cover the repair charge." });
  const reprinted = Boolean(repair.receipt?.number);
  if (!repair.receipt?.number) {
    const issuedAt = new Date();
    const number = repair.invoiceNumber || `ACGC-R-${String(repair._id).slice(-8).toUpperCase()}`;
    repair.receipt = { number, issuedAt, issuedBy: req.user.id, issuedByRole: req.user.role, amountPaidAtIssue: repair.workflowType === "warranty" ? 0 : verifiedRepairAmount(repair) };
    repair.invoiceNumber = number;
    event(repair, "receipt_issued", `Repair receipt ${number} issued for ${repair.workflowType === "warranty" ? "warranty-covered service" : `PHP ${verifiedRepairAmount(repair).toFixed(2)} verified payment`}.`, req.user);
    await repair.save();
  }
  return res.json({ success: true, repair: publicAdmin(repair), reprinted });
};

export const closeDuplicateRepair = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (!repair.duplicateReview?.flagged || !repair.duplicateReview?.duplicateOf) return res.status(409).json({ success: false, message: "Only a ticket flagged as a duplicate can be closed through this review action." });
  if (!ACTIVE_REPAIR_STATUSES.includes(repair.status)) return res.status(409).json({ success: false, message: "This duplicate ticket is already closed." });
  const reason = text(req.body?.reason, 1200);
  if (reason.length < 10) return res.status(400).json({ success: false, message: "Provide at least 10 characters explaining why this duplicate ticket is being closed." });
  const primary = await RepairRequest.findById(repair.duplicateReview.duplicateOf).select("repairTrackingId").lean();
  if (!primary) return res.status(409).json({ success: false, message: "The primary repair ticket linked to this duplicate could not be found." });
  repair.status = "cancelled";
  repair.duplicateReview.resolvedAt = new Date();
  repair.duplicateReview.resolvedBy = req.user.id;
  repair.duplicateReview.resolutionReason = reason;
  event(repair, "duplicate_cancelled", `Administrator closed this duplicate repair ticket after review. Primary ticket: ${primary.repairTrackingId || repair.duplicateReview.duplicateOf}. Reason: ${reason}`, req.user);
  await repair.save();
  void quoteCustomer(repair, `Repair ticket closed after duplicate review: ${repair.productName}`, `Repair ticket ${repair.repairTrackingId} was closed after an administrator reviewed it as a duplicate of ${primary.repairTrackingId || "another ticket"}. Reason: ${reason}`);
  return res.json({ success: true, repair: publicAdmin(repair) });
};

export const scheduleRepair = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (!["customer_accepted", "admin_approved", "scheduled"].includes(repair.status)) return res.status(409).json({ success: false, message: "Approve the warranty claim or receive quotation acceptance before scheduling." });
  const startValue = text(req.body?.startDate || req.body?.date, 10);
  if (repair.status === "scheduled" && req.body?.reschedule !== true) return res.status(409).json({ success: false, message: "This repair already has a schedule. Confirm that you are editing or rescheduling the existing appointment." });
  if (repair.status !== "scheduled" && req.body?.reschedule === true) return res.status(409).json({ success: false, message: "Only an already scheduled repair can be rescheduled." });
  // Require the finish date explicitly. Falling back to startDate silently
  // collapsed multi-day repairs into a single-day schedule.
  const finishValue = text(req.body?.finishDate, 10);
  const manilaDateParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const manilaDateValues = Object.fromEntries(manilaDateParts.map(({ type, value }) => [type, value]));
  const todayInManila = `${manilaDateValues.year}-${manilaDateValues.month}-${manilaDateValues.day}`;
  const parseScheduleDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(NaN);
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : new Date(NaN);
  };
  const startDate = parseScheduleDate(startValue);
  const finishDate = parseScheduleDate(finishValue);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(finishDate.getTime()) || startDate.toISOString().slice(0, 10) !== startValue || finishDate.toISOString().slice(0, 10) !== finishValue || finishDate < startDate) return res.status(400).json({ success: false, message: "Choose valid start and finish dates. Finish date cannot be before start date." });
  if (startValue < todayInManila) return res.status(400).json({ success: false, message: "Repair schedules cannot start in the past." });
  const previousSchedule = repair.schedule?.startDate || repair.schedule?.date;
  const previousFinish = repair.schedule?.finishDate || previousSchedule;
  const previousStartKey = previousSchedule ? new Date(previousSchedule).toISOString().slice(0, 10) : "";
  const previousFinishKey = previousFinish ? new Date(previousFinish).toISOString().slice(0, 10) : "";
  const nextNotes = text(req.body?.notes, 1200);
  const scheduleIsUnchanged = previousSchedule
    && previousStartKey === startValue
    && previousFinishKey === finishValue
    && String(repair.schedule?.notes || "") === nextNotes;
  if (scheduleIsUnchanged) return res.json({ success: true, repair: publicAdmin(repair) });
  if (previousSchedule) {
    event(repair, "rescheduled", `Repair appointment changed from ${new Date(previousSchedule).toLocaleDateString("en-PH")} through ${new Date(previousFinish).toLocaleDateString("en-PH")} to ${startDate.toLocaleDateString("en-PH")} through ${finishDate.toLocaleDateString("en-PH")}.${nextNotes ? ` ${nextNotes}` : ""}`, req.user);
  } else {
    event(repair, "scheduled", `Repair scheduled from ${startDate.toLocaleDateString("en-PH")} through ${finishDate.toLocaleDateString("en-PH")}.${nextNotes ? ` ${nextNotes}` : ""}`, req.user);
  }
  repair.schedule = { date: startDate, startDate, finishDate, notes: nextNotes };
  repair.status = "scheduled";
  await repair.save();
  void quoteCustomer(repair, `Repair scheduled: ${repair.productName}`, `Your repair is scheduled from ${startDate.toLocaleDateString("en-PH")} through ${finishDate.toLocaleDateString("en-PH")}.`);
  res.json({ success: true, repair: publicAdmin(repair) });
};

export const startRepair = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.status !== "scheduled") return res.status(409).json({ success: false, message: "Only a scheduled repair can be started." });
  repair.startedAt = new Date();
  repair.status = "in_progress";
  event(repair, "in_progress", "Repair work started.", req.user);
  await repair.save();
  res.json({ success: true, repair: publicAdmin(repair) });
};

export const completeRepair = async (req, res) => {
  const repair = await getRepair(req.params.repairId);
  if (!repair) return res.status(404).json({ success: false, message: "Repair request not found." });
  if (repair.status !== "in_progress") return res.status(409).json({ success: false, message: "Only an in-progress repair can be completed." });
  const notes = text(req.body?.notes);
  if (!notes) return res.status(400).json({ success: false, message: "Add completion notes." });
  const amountPaid = repair.workflowType === "warranty" ? 0 : verifiedRepairAmount(repair);
  const evidenceUrls = Array.isArray(req.body?.evidenceUrls) ? req.body.evidenceUrls.slice(0, 10).map((url) => text(url, 1200)).filter((url) => /^https:\/\//i.test(url)) : [];
  // completedAt is the actual completion instant. Schedule dates remain separately stored.
  repair.completion = { notes, amountPaid, evidenceUrls, completedAt: new Date() };
  if (repair.workflowType === "warranty") {
    repair.payment.status = "not_required";
    repair.payment.receivedAt = null;
  }
  repair.status = "completed";
  event(repair, "completed", notes, req.user);
  await repair.save();
  const paymentMessage = repair.workflowType === "warranty"
    ? "No payment is required for this warranty-covered repair."
    : `Verified amount paid: PHP ${verifiedRepairAmount(repair).toFixed(2)} of PHP ${repairTotal(repair).toFixed(2)}. Any receipt will be issued by an administrator after full payment verification.`;
  void quoteCustomer(repair, `Repair completed: ${repair.productName}`, `Your repair is complete. ${paymentMessage}`);
  res.json({ success: true, repair: publicAdmin(repair) });
};
