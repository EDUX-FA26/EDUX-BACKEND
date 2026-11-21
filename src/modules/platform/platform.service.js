"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../../config/db.config");
const EmailService = require("../../config/email.config");
const platformRepository = require("./platform.repository");
const platformAuditService = require("./platformAudit.service");
const notificationsRepository = require("../notifications/notifications.repository");
const { emitCreatedNotifications } = require("../notifications/notifications.realtime");

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove Vietnamese accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PlatformService = {
  // =========================================================================
  // MANAGERS
  // =========================================================================

  async listManagers(query = {}) {
    return await platformRepository.listManagers(query);
  },

  async createManager({ email, username, password, fullName, actorId, ipAddress }) {
    if (!email || !password || !username) {
      const err = new Error("Email, username and password are required");
      err.status = 400;
      throw err;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const manager = await platformRepository.createManagerAccount({
      email: email.toLowerCase().trim(),
      username: username.trim(),
      passwordHash,
      fullName: fullName ? fullName.trim() : null,
      grantedBy: actorId,
    });

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "CREATE_MANAGER",
      targetType: "user",
      targetId: manager.id,
      metadata: { email: manager.email, username: manager.username },
      ipAddress,
    });

    return manager;
  },

  async toggleManagerStatus({ userId, isActive, actorId, ipAddress }) {
    const updated = await platformRepository.toggleManagerStatus(userId, isActive);
    if (!updated) {
      const err = new Error("Manager not found");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: isActive ? "ACTIVATE_MANAGER" : "DEACTIVATE_MANAGER",
      targetType: "platform_admin",
      targetId: userId,
      metadata: { is_active: isActive },
      ipAddress,
    });

    return updated;
  },

  async updateManager({ userId, email, username, fullName, password, actorId, ipAddress }) {
    if (userId === actorId) {
      const error = new Error("Cannot change your own platform identity from this endpoint");
      error.status = 400;
      throw error;
    }
    if (email !== undefined) {
      const error = new Error("Manager email changes require the verified-email workflow and are not available yet");
      error.status = 409;
      throw error;
    }
    let passwordHash = null;
    if (password && typeof password === "string" && password.trim().length > 0) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }
    const updated = await platformRepository.updateManager(userId, {
      username: username?.trim(),
      fullName: fullName?.trim(),
      passwordHash,
    });
    if (!updated) { const error = new Error("Manager not found"); error.status = 404; throw error; }
    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "UPDATE_MANAGER",
      targetType: "platform_admin",
      targetId: userId,
      metadata: { email: updated.email, username: updated.username, password_updated: !!passwordHash },
      ipAddress
    });
    return updated;
  },

  async deleteManager({ userId, actorId, ipAddress }) {
    if (userId === actorId) {
      const err = new Error("Cannot delete your own platform account");
      err.status = 400;
      throw err;
    }

    const deleted = await platformRepository.deleteManager(userId);
    if (!deleted) {
      const err = new Error("Manager not found or cannot be deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "DELETE_MANAGER",
      targetType: "platform_admin",
      targetId: userId,
      ipAddress,
    });

    return { success: true };
  },

  // =========================================================================
  // PLANS
  // =========================================================================

  async listPlans(includeInactive = false) {
    return await platformRepository.listPlans(includeInactive);
  },

  async createPlan(data, { actorId, ipAddress } = {}) {
    if (!data.id || !data.name || data.price_monthly === undefined || data.price_yearly === undefined) {
      const err = new Error("Plan id, name, price_monthly, and price_yearly are required");
      err.status = 400;
      throw err;
    }

    const plan = await platformRepository.createPlan(data);

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "CREATE_SUBSCRIPTION_PLAN",
      targetType: "subscription_plan",
      targetId: plan.id,
      metadata: { name: plan.name, price_monthly: plan.price_monthly },
      ipAddress,
    });

    return plan;
  },

  async updatePlan(id, data, { actorId, ipAddress } = {}) {
    const updated = await platformRepository.updatePlan(id, data);
    if (!updated) {
      const err = new Error("Subscription plan not found");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "UPDATE_SUBSCRIPTION_PLAN",
      targetType: "subscription_plan",
      targetId: id,
      metadata: data,
      ipAddress,
    });

    return updated;
  },

  async deletePlan(id, { actorId, ipAddress } = {}) {
    const result = await platformRepository.deletePlan(id);
    if (!result?.plan) {
      const err = new Error("Subscription plan not found");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: result.action === "deactivated" ? "DEACTIVATE_SUBSCRIPTION_PLAN" : "DELETE_SUBSCRIPTION_PLAN",
      targetType: "subscription_plan",
      targetId: id,
      metadata: { action: result.action, planId: id },
      ipAddress,
    });

    return result;
  },

  // =========================================================================
  // SCHOOLS / TENANTS
  // =========================================================================

  async listSchools(filter) {
    return await platformRepository.listSchools(filter);
  },

  async getSchoolDetails(schoolId) {
    const school = await platformRepository.getSchoolById(schoolId);
    if (!school) {
      const err = new Error("School not found");
      err.status = 404;
      throw err;
    }
    return school;
  },

  async createSchool(_input = {}, { actorId, actorRole, ipAddress } = {}) {
    // A manager never supplies a school name or code. The tenant is handed
    // over first; its school_admin supplies profile data during setup.
    const school = await platformRepository.createSchool();

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "CREATE_SCHOOL",
      targetType: "school",
      targetId: school.id,
      metadata: { code: school.code, status: school.status },
      ipAddress,
    });

    return school;
  },

  async lockSchool(schoolId, reason, { actorId, actorRole, ipAddress } = {}) {
    const locked = await platformRepository.lockSchool(schoolId, reason);
    if (!locked) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "LOCK_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      metadata: { reason },
      ipAddress,
    });

    return locked;
  },

  async unlockSchool(schoolId, { actorId, actorRole, ipAddress } = {}) {
    const unlocked = await platformRepository.unlockSchool(schoolId);
    if (!unlocked) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "UNLOCK_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      ipAddress,
    });

    return unlocked;
  },

  async suspendSchool(schoolId, reason, { actorId, actorRole, ipAddress } = {}) {
    const suspended = await platformRepository.suspendSchool(schoolId, reason);
    if (!suspended) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "SUSPEND_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      metadata: { reason },
      ipAddress,
    });

    return suspended;
  },

  async unsuspendSchool(schoolId, { actorId, actorRole, ipAddress } = {}) {
    const unsuspended = await platformRepository.unsuspendSchool(schoolId);
    if (!unsuspended) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "UNSUSPEND_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      ipAddress,
    });

    return unsuspended;
  },

  async softDeleteSchool(schoolId, { actorId, actorRole, ipAddress } = {}) {
    const deleted = await platformRepository.softDeleteSchool(schoolId);
    if (!deleted) {
      const err = new Error("School not found or already deleted");
      err.status = 404;
      throw err;
    }

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "SOFT_DELETE_SCHOOL",
      targetType: "school",
      targetId: schoolId,
      ipAddress,
    });

    return deleted;
  },

  // =========================================================================
  // HANDOVER & INVITATION
  // =========================================================================

  async inviteSchoolAdmin({ schoolId, email }, { actorId, actorRole, ipAddress } = {}) {
    if (!email) {
      const err = new Error("Recipient email is required");
      err.status = 400;
      throw err;
    }

    const school = await platformRepository.getSchoolById(schoolId);
    if (!school) {
      const err = new Error("School not found");
      err.status = 404;
      throw err;
    }

    // Generate random raw token and store its SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await platformRepository.createInvitation({
      schoolId,
      recipientEmail: email,
      tokenHash,
      invitedBy: actorId,
      expiresAt,
    });

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "INVITE_SCHOOL_ADMIN",
      targetType: "school",
      targetId: schoolId,
      metadata: { email, invitationId: invitation.id },
      ipAddress,
    });

    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const invitePath = `/onboarding?token=${rawToken}`;
    const fullInviteUrl = `${clientUrl}${invitePath}`;

    // Send invitation email in the background
    setImmediate(async () => {
      try {
        await EmailService.sendEmail({
          to: email,
          subject: `[EDUX] Thư mời tiếp nhận Quản trị trường: ${school.name}`,
          message: `Xin chào,\n\nBạn đã được Ban Quản trị Nền tảng EDUX mời tiếp nhận quyền Quản trị viên (School Admin) cho cơ sở trường học "${school.name}" (${school.code}).\n\nVui lòng truy cập liên kết sau để thiết lập mật khẩu và bắt đầu quản trị trường:\n${fullInviteUrl}\n\nLiên kết này có hiệu lực trong vòng 7 ngày.\n\nTrân trọng,\nBan Quản trị EDUX`,
          html: `
            <div style="max-width: 600px; margin: 0 auto; font-family: 'Segoe UI', Arial, sans-serif; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
              <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 24px; text-align: center; color: #ffffff;">
                <h1 style="margin: 0; font-size: 22px; font-weight: 700;">EDUX PLATFORM</h1>
                <p style="margin: 6px 0 0; font-size: 13px; opacity: 0.9;">Cổng tiếp nhận Quản trị Trường học</p>
              </div>
              <div style="padding: 28px 24px;">
                <h2 style="margin: 0 0 16px; font-size: 18px; color: #0f172a;">Lời mời tiếp nhận cơ sở đào tạo</h2>
                <p style="font-size: 14px; color: #334155; line-height: 1.6;">
                  Xin chào <strong>${email}</strong>,<br/><br/>
                  Bạn vừa được Ban Quản trị Nền tảng EDUX mời tiếp nhận quyền <strong>Quản trị viên (School Admin)</strong> cho cơ sở:
                </p>
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
                  <p style="margin: 0 0 8px; font-weight: 600; color: #1e40af; font-size: 16px;">${school.name}</p>
                  <p style="margin: 0; font-size: 13px; color: #64748b;">Mã định danh trường: <strong>${school.code}</strong></p>
                </div>
                <div style="text-align: center; margin: 28px 0;">
                  <a href="${fullInviteUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; text-decoration: none; display: inline-block;">Kích hoạt & Tiếp nhận trường</a>
                </div>
                <p style="font-size: 12px; color: #94a3b8; line-height: 1.5;">
                  * Liên kết mời tiếp nhận này có hiệu lực trong vòng <strong>7 ngày</strong>.<br/>
                  Nếu nút trên không hoạt động, bạn có thể dán đường dẫn sau vào trình duyệt:<br/>
                  <a href="${fullInviteUrl}" style="color: #2563eb; word-break: break-all;">${fullInviteUrl}</a>
                </p>
              </div>
              <div style="background-color: #f1f5f9; padding: 14px 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
                © 2026 EDUX System. All rights reserved.
              </div>
            </div>
          `,
        });
        console.log(`[Invitation Email] Sent successfully to ${email}`);
      } catch (mailErr) {
        console.warn(`[Invitation Email] Failed to send to ${email}:`, mailErr.message);
      }
    });

    // In local/sandbox development or demo, return the rawToken & invite URL for easy testing
    return {
      invitationId: invitation.id,
      recipientEmail: invitation.recipient_email,
      expiresAt: invitation.expires_at,
      rawToken,
      inviteUrl: invitePath,
      fullInviteUrl,
    };
  },

  async verifyInvitation(rawToken) {
    if (!rawToken) {
      const err = new Error("Token is required");
      err.status = 400;
      throw err;
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const invitation = await platformRepository.findInvitationByToken(tokenHash);

    if (!invitation) {
      const err = new Error("Lời mời không hợp lệ hoặc không tồn tại");
      err.status = 404;
      throw err;
    }

    if (invitation.status !== "pending") {
      const err = new Error(`Lời mời này đã ở trạng thái: ${invitation.status}`);
      err.status = 400;
      throw err;
    }

    if (new Date(invitation.expires_at) < new Date()) {
      const err = new Error("Lời mời đã hết hạn");
      err.status = 400;
      throw err;
    }

    return invitation;
  },

  async acceptInvitation({ rawToken, userId }) {
    if (!rawToken) {
      const err = new Error("Token is required");
      err.status = 400;
      throw err;
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const invitation = await platformRepository.acceptInvitation({ tokenHash, userId });

    await platformAuditService.log({
      actorId: userId,
      actorRole: "school_admin",
      action: "ACCEPT_SCHOOL_INVITATION",
      targetType: "school",
      targetId: invitation.school_id,
      metadata: { invitationId: invitation.id },
    });

    return {
      schoolId: invitation.school_id,
      schoolName: invitation.school_name,
      schoolCode: invitation.school_code,
    };
  },

  // =========================================================================
  // CONTRACTS & TRANSACTIONS
  // =========================================================================

  async listContracts(query) {
    return await platformRepository.listContracts(query);
  },

  async remindSubscriptionRenewal(subscriptionId, { actorId, actorRole, ipAddress } = {}) {
    const { rows: subRows } = await pool.query(
      `SELECT ss.*, s.name AS school_name, sp.name AS plan_name
       FROM public.school_subscriptions ss
       JOIN public.schools s ON s.id = ss.school_id
       LEFT JOIN public.subscription_plans sp ON sp.id = ss.plan_id
       WHERE ss.id = $1 LIMIT 1`,
      [subscriptionId]
    );

    if (!subRows[0]) {
      const err = new Error("Hợp đồng thuê không tồn tại");
      err.status = 404;
      throw err;
    }

    const sub = subRows[0];
    const { rows: adminRows } = await pool.query(
      `SELECT sm.user_id, u.email, up.full_name
       FROM public.school_memberships sm
       JOIN public.users u ON u.id = sm.user_id
       LEFT JOIN public.user_profiles up ON up.user_id = u.id
       WHERE sm.school_id = $1 AND sm.role = 'school_admin' AND sm.status = 'active' AND u.is_active = TRUE`,
      [sub.school_id]
    );

    if (adminRows.length === 0) {
      const err = new Error("Không tìm thấy tài khoản Quản trị trường (School Admin) đang hoạt động để gửi thông báo nhắc nhở.");
      err.status = 400;
      throw err;
    }

    const endDateStr = sub.end_date ? new Date(sub.end_date).toLocaleDateString("vi-VN") : "sắp tới";
    const notifications = adminRows.map((row) => ({
      userId: row.user_id,
      title: "Nhắc nhở gia hạn hợp đồng EDUX",
      message: `Gói dịch vụ "${sub.plan_name || 'EDUX'}" của trường bạn sẽ hết hạn vào ngày ${endDateStr}. Vui lòng kiểm tra và gia hạn tại mục Cài đặt trường / Billing để duy trì dịch vụ.`,
      type: "renewal_reminder",
      related_entity_type: "school_subscription",
      related_entity_id: sub.id,
      notification_scope: "school",
      school_id: sub.school_id,
    }));

    let created = [];
    try {
      created = await notificationsRepository.bulkCreate(notifications);
    } catch (createErr) {
      // Fallback safely to system_announcement in case of DB constraint variation
      console.warn("[remindSubscriptionRenewal] Retrying with system_announcement fallback:", createErr.message);
      const fallbackNotifs = notifications.map(n => ({ ...n, type: "system_announcement" }));
      created = await notificationsRepository.bulkCreate(fallbackNotifs);
    }
    emitCreatedNotifications(created);

    // Send renewal reminder emails
    setImmediate(async () => {
      for (const admin of adminRows) {
        if (admin.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email)) {
          try {
            await EmailService.sendEmail({
              to: admin.email,
              subject: `[EDUX] Nhắc nhở gia hạn hợp đồng cơ sở "${sub.school_name}"`,
              message: `Kính gửi ${admin.full_name || 'Quản trị viên'},\n\nGói dịch vụ "${sub.plan_name || 'EDUX'}" của trường "${sub.school_name}" sẽ hết hạn vào ngày ${endDateStr}.\n\nVui lòng truy cập trang Cài đặt trường / Billing để tiến hành gia hạn dịch vụ nhằm tránh gián đoạn truy cập của giảng viên và sinh viên.\n\nTrân trọng,\nBan Quản trị EDUX`,
              html: `
                <div style="max-width: 600px; margin: 0 auto; font-family: 'Segoe UI', Arial, sans-serif; background-color: #ffffff; border: 1px solid #fde68a; border-radius: 12px; overflow: hidden;">
                  <div style="background: linear-gradient(135deg, #d97706, #f59e0b); padding: 24px; text-align: center; color: #ffffff;">
                    <h1 style="margin: 0; font-size: 22px; font-weight: 700;">EDUX PLATFORM</h1>
                    <p style="margin: 6px 0 0; font-size: 13px; opacity: 0.9;">Thông báo thời hạn dịch vụ hợp đồng</p>
                  </div>
                  <div style="padding: 28px 24px;">
                    <h2 style="margin: 0 0 16px; font-size: 18px; color: #92400e;">Nhắc nhở gia hạn hợp đồng trường học</h2>
                    <p style="font-size: 14px; color: #334155; line-height: 1.6;">
                      Kính gửi <strong>${admin.full_name || admin.email}</strong>,<br/><br/>
                      Gói dịch vụ bản quyền của cơ sở <strong>${sub.school_name}</strong> chuẩn bị đến hạn gia hạn:
                    </p>
                    <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 16px; margin: 16px 0;">
                      <p style="margin: 0 0 6px; font-size: 14px;"><strong>Gói dịch vụ:</strong> ${sub.plan_name || 'EDUX Standard'}</p>
                      <p style="margin: 0; font-size: 14px; color: #b45309;"><strong>Ngày hết hạn:</strong> ${endDateStr}</p>
                    </div>
                    <p style="font-size: 13px; color: #475569; line-height: 1.5;">
                      Để đảm bảo các hoạt động học tập, giảng dạy và kiểm tra không bị gián đoạn, quý trường vui lòng đăng nhập tài khoản Quản trị trường và thực hiện gia hạn hợp đồng.
                    </p>
                  </div>
                  <div style="background-color: #f1f5f9; padding: 14px 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
                    © 2026 EDUX System. All rights reserved.
                  </div>
                </div>
              `,
            });
            console.log(`[Renewal Email] Sent successfully to ${admin.email}`);
          } catch (mErr) {
            console.warn(`[Renewal Email] Failed to send to ${admin.email}:`, mErr.message);
          }
        }
      }
    });

    await platformAuditService.log({
      actorId,
      actorRole,
      action: "REMIND_SUBSCRIPTION_RENEWAL",
      targetType: "school_subscription",
      targetId: subscriptionId,
      metadata: { school_id: sub.school_id, notified_admins: adminRows.length },
      ipAddress,
    });

    return { success: true, count: created.length, school_name: sub.school_name };
  },

  async listTransactions(query) {
    return await platformRepository.listTransactions(query);
  },

  async getRevenueReports() {
    return await platformRepository.getRevenueReports();
  },

  async listAuditLogs(query) {
    return await platformAuditService.listLogs(query);
  },

  // =========================================================================
  // REFUNDS
  // =========================================================================

  async listRefunds(query) {
    return await platformRepository.listRefunds(query);
  },

  async approveRefund(id, { actorId, ipAddress } = {}) {
    const refund = await platformRepository.findRefundById(id);
    if (!refund) {
      const err = new Error("Refund request not found");
      err.status = 404;
      throw err;
    }
    if (refund.status !== "requested") {
      const err = new Error(`Cannot approve refund in status: ${refund.status}`);
      err.status = 400;
      throw err;
    }

    const updated = await platformRepository.approveRefund(id, actorId);

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "APPROVE_REFUND",
      targetType: "payment_refund",
      targetId: id,
      metadata: { schoolId: refund.school_id, amount: refund.amount },
      ipAddress,
    });

    return updated;
  },

  async rejectRefund(id, reason, { actorId, ipAddress } = {}) {
    const refund = await platformRepository.findRefundById(id);
    if (!refund) {
      const err = new Error("Refund request not found");
      err.status = 404;
      throw err;
    }
    if (refund.status !== "requested" && refund.status !== "approved") {
      const err = new Error(`Cannot reject refund in status: ${refund.status}`);
      err.status = 400;
      throw err;
    }

    const updated = await platformRepository.rejectRefund(id, actorId, reason);

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "REJECT_REFUND",
      targetType: "payment_refund",
      targetId: id,
      metadata: { schoolId: refund.school_id, amount: refund.amount, reason },
      ipAddress,
    });

    return updated;
  },

  async executeRefund(id, payload = {}, { actorId, ipAddress } = {}) {
    const refund = await platformRepository.findRefundById(id);
    if (!refund) {
      const err = new Error("Refund request not found");
      err.status = 404;
      throw err;
    }

    const result = await platformRepository.executeRefund(id, {
      payoutReference: payload.payoutReference,
      notes: payload.notes,
      actorId,
    });

    await platformAuditService.log({
      actorId,
      actorRole: "superadmin",
      action: "EXECUTE_REFUND",
      targetType: "payment_refund",
      targetId: id,
      metadata: { schoolId: refund.school_id, amount: refund.amount, payoutReference: payload.payoutReference },
      ipAddress,
    });

    return result;
  },
};

module.exports = PlatformService;
