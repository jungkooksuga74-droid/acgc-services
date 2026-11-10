import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    pending_email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },
    pending_email_verification_code: {
      type: String,
      default: null,
    },
    pending_email_verification_expires: {
      type: Date,
      default: null,
    },
    pending_email_verification_attempts: {
      type: Number,
      default: 0,
    },
    pending_email_verification_sent_at: {
      type: Date,
      default: null,
    },
    pending_username: { type: String, lowercase: true, trim: true, minlength: 6, maxlength: 12, default: null },
    pending_username_verification_code: { type: String, default: null },
    pending_username_verification_expires: { type: Date, default: null },
    pending_username_verification_attempts: { type: Number, default: 0 },
    pending_username_verification_sent_at: { type: Date, default: null },
    username_change_verified_until: { type: Date, default: null },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    first_name: {
      type: String,
      required: true,
      trim: true,
    },
    last_name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      default: "",
      trim: true,
    },
    street_address: {
      type: String,
      default: "",
      trim: true,
    },
    city: {
      type: String,
      default: "",
      trim: true,
    },
    province: {
      type: String,
      default: "",
      trim: true,
    },
    zip_code: {
      type: String,
      default: "",
      trim: true,
    },
    role: {
      type: String,
      enum: ["customer", "skilled_worker", "admin", "super_admin"],
      default: "customer",
    },
    session_version: {
      type: Number,
      default: 0,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    email_verified: {
      type: Boolean,
      default: false,
    },
    privacy_policy_acknowledgments: {
      type: [{
        account_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        document_version: { type: String, required: true, trim: true },
        acknowledged_at: { type: Date, required: true },
      }],
      default: [],
    },
    terms_and_conditions_acceptances: {
      type: [{
        account_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        document_version: { type: String, required: true, trim: true },
        accepted_at: { type: Date, required: true },
      }],
      default: [],
    },
    customer_cancellation_count: {
      type: Number,
      min: 0,
      default: 0,
    },
    online_order_cooldown_until: {
      type: Date,
      default: null,
    },
    email_verification_token: {
      type: String,
      default: null,
    },
    email_verification_expires: {
      type: Date,
      default: null,
    },
    password_reset_code: {
      type: String,
      default: null,
      select: false,
    },
    password_reset_expires: {
      type: Date,
      default: null,
    },
    password_reset_sent_at: {
      type: Date,
      default: null,
    },
    password_reset_attempts: {
      type: Number,
      default: 0,
    },
    password_reset_request_window_started_at: {
      type: Date,
      default: null,
    },
    password_reset_request_count: {
      type: Number,
      default: 0,
    },
    password_reset_request_lock_until: {
      type: Date,
      default: null,
    },
    access_permissions: {
      can_request_orders: { type: Boolean, default: true },
      can_estimate_pricing: { type: Boolean, default: true },
      view_only_access: { type: Boolean, default: false },
      can_track_products: { type: Boolean, default: true },
      can_upload_feedback: { type: Boolean, default: true },
      show_ratings_homepage: { type: Boolean, default: true },
    },
    staff_access: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.index(
  { pending_email: 1 },
  { unique: true, partialFilterExpression: { pending_email: { $type: "string" } } },
);
UserSchema.index(
  { pending_username: 1 },
  { unique: true, partialFilterExpression: { pending_username: { $type: "string" } } },
);

// Hash password before saving
UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Don't return password in JSON
UserSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
    delete user.email_verification_token;
    delete user.email_verification_expires;
    delete user.pending_email_verification_code;
    delete user.pending_email_verification_expires;
    delete user.pending_email_verification_attempts;
    delete user.pending_email_verification_sent_at;
    delete user.pending_username;
    delete user.pending_username_verification_code;
    delete user.pending_username_verification_expires;
    delete user.pending_username_verification_attempts;
    delete user.pending_username_verification_sent_at;
    delete user.username_change_verified_until;
    delete user.password_reset_code;
    delete user.password_reset_expires;
    delete user.password_reset_sent_at;
    delete user.password_reset_attempts;
    delete user.password_reset_request_window_started_at;
    delete user.password_reset_request_count;
    delete user.password_reset_request_lock_until;
  return user;
};

export default mongoose.model("User", UserSchema);
