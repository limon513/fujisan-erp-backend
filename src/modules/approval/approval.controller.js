import sendResponse from "#core/utils/sendResponse.js";
import { ApprovalService } from "./approval.service.js";

const id = (req) => req.valid.params.id;

const inbox = async (req, res) => {
  const { data, meta } = await ApprovalService.inbox(req.actor, req.valid.query);
  return sendResponse(res, { message: "Requests waiting for you", data, meta });
};

const inboxCount = async (req, res) =>
  sendResponse(res, {
    message: "Requests waiting for you",
    data: await ApprovalService.inboxCount(req.actor),
  });

const mine = async (req, res) => {
  const { data, meta } = await ApprovalService.mine(req.actor, req.valid.query);
  return sendResponse(res, { message: "Your requests", data, meta });
};

const list = async (req, res) => {
  const { data, meta } = await ApprovalService.list(
    { actor: req.actor, scope: req.access.scope },
    req.valid.query,
  );
  return sendResponse(res, { message: "Approval requests retrieved", data, meta });
};

const getById = async (req, res) =>
  sendResponse(res, {
    message: "Approval request retrieved",
    data: await ApprovalService.getById(req.actor, id(req)),
  });

const approve = async (req, res) =>
  sendResponse(res, {
    message: "Approved",
    data: await ApprovalService.approve(req.actor, id(req), req.body),
  });

const reject = async (req, res) =>
  sendResponse(res, {
    message: "Rejected",
    data: await ApprovalService.reject(req.actor, id(req), req.body),
  });

const cancel = async (req, res) =>
  sendResponse(res, {
    message: "Request withdrawn",
    data: await ApprovalService.cancel(req.actor, id(req), req.body),
  });

const listWorkflows = async (req, res) =>
  sendResponse(res, {
    message: "Approval workflows retrieved",
    data: await ApprovalService.listWorkflows(),
  });

const getWorkflow = async (req, res) =>
  sendResponse(res, {
    message: "Approval workflow retrieved",
    data: await ApprovalService.findWorkflow(id(req)),
  });

const updateWorkflow = async (req, res) =>
  sendResponse(res, {
    message: "Approval workflow updated",
    data: await ApprovalService.updateWorkflow(req.actor, id(req), req.body),
  });

export const ApprovalController = {
  inbox,
  inboxCount,
  mine,
  list,
  getById,
  approve,
  reject,
  cancel,
  listWorkflows,
  getWorkflow,
  updateWorkflow,
};
