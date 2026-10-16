export const searchableFields = ["fullName", "employeeCode", "mobile", "email"];

export const sortableFields = ["fullName", "employeeCode", "joiningDate", "createdAt"];

/** Employee code sequence (EMP-0001, EMP-0002, ...). */
export const EMPLOYEE_SEQUENCE = { key: "EMPLOYEE", prefix: "EMP-", padding: 4 };

/** Statuses that end employment: the login is disabled and sessions are revoked. */
export const INACTIVE_STATUSES = ["SUSPENDED", "RESIGNED", "TERMINATED"];

/** For data scope: an employee record is "owned" by itself. */
export const SCOPE_FIELDS = { owner: "id" };

const ref = { select: { id: true, name: true } };

export const employeeListSelect = {
  id: true,
  employeeCode: true,
  fullName: true,
  photoFileId: true,
  mobile: true,
  email: true,
  employmentType: true,
  employmentStatus: true,
  joiningDate: true,
  branch: ref,
  department: ref,
  designation: ref,
  team: ref,
  reportingManager: { select: { id: true, fullName: true, employeeCode: true } },
  user: {
    select: { id: true, username: true, status: true, role: { select: { id: true, name: true } } },
  },
};

export const employeeDetailSelect = {
  ...employeeListSelect,
  gender: true,
  dateOfBirth: true,
  nidNumber: true,
  bloodGroup: true,
  presentAddress: true,
  permanentAddress: true,
  emergencyContact: true,
  exitDate: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { directReports: { where: { deletedAt: null } } } },
};

export const toEmployeeDto = ({ _count, ...employee }) => ({
  ...employee,
  ...(_count && { directReportCount: _count.directReports }),
});
