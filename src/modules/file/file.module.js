import { FileRoute } from "./file.route.js";
import "./file.docs.js";

export default {
  name: "file",
  basePath: "/files",
  router: FileRoute,
  core: true,
  // Linking files to records is checked by the owning module (e.g. project.edit for a layout)
  permissions: [],
};
