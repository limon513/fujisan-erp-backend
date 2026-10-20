export const CUSTOMER_SEQUENCE = { key: "CUSTOMER", prefix: "CUS-", padding: 6 };

export const searchableFields = [
  "fullName",
  "customerCode",
  "mobile",
  "altMobile",
  "email",
  "nidNumber",
];

export const sortableFields = ["createdAt", "fullName", "customerCode"];

export const DOCUMENT_CATEGORIES = ["NID", "PHOTO", "PASSPORT", "TIN", "DOCUMENT", "OTHER"];

const owner = {
  select: {
    id: true,
    fullName: true,
    employeeCode: true,
    designation: { select: { name: true } },
    team: { select: { id: true, name: true } },
  },
};

export const customerListSelect = {
  id: true,
  customerCode: true,
  fullName: true,
  mobile: true,
  email: true,
  nidNumber: true,
  profession: true,
  createdAt: true,
  owner,
};

export const customerDetailSelect = {
  ...customerListSelect,
  fatherName: true,
  motherName: true,
  spouseName: true,
  dateOfBirth: true,
  gender: true,
  passportNumber: true,
  tin: true,
  organization: true,
  altMobile: true,
  presentAddress: true,
  permanentAddress: true,
  photoFileId: true,
  notes: true,
  updatedAt: true,
  nominees: { orderBy: { createdAt: "asc" } },
};
