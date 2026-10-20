export const searchableFields = ["code", "name", "address", "district", "upazila"];

export const sortableFields = ["name", "code", "launchDate", "createdAt"];

export const PLOT_STATUSES = ["AVAILABLE", "HOLD", "BOOKED", "SOLD", "BLOCKED"];

const ref = { select: { id: true, name: true } };

export const projectSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  description: true,
  address: true,
  district: true,
  upazila: true,
  latitude: true,
  longitude: true,
  landAreaDecimal: true,
  launchDate: true,
  expectedHandoverDate: true,
  defaultHoldDays: true,
  isActive: true,
  layoutFileId: true,
  layoutWidth: true,
  layoutHeight: true,
  createdAt: true,
  updatedAt: true,
  branch: ref,
  projectManager: { select: { id: true, fullName: true, employeeCode: true } },
  _count: { select: { blocks: true, roads: true } },
};
