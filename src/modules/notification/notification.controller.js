import sendResponse from "#core/utils/sendResponse.js";
import { NotificationService } from "./notification.service.js";

const list = async (req, res) => {
  const { data, meta } = await NotificationService.list(req.actor, req.valid.query);
  return sendResponse(res, { message: "Notifications retrieved", data, meta });
};

const unreadCount = async (req, res) =>
  sendResponse(res, {
    message: "Unread notifications",
    data: await NotificationService.unreadCount(req.actor),
  });

const markRead = async (req, res) =>
  sendResponse(res, {
    message: "Marked as read",
    data: await NotificationService.markRead(req.actor, req.valid.params.id),
  });

const markAllRead = async (req, res) =>
  sendResponse(res, {
    message: "All marked as read",
    data: await NotificationService.markAllRead(req.actor),
  });

export const NotificationController = { list, unreadCount, markRead, markAllRead };
