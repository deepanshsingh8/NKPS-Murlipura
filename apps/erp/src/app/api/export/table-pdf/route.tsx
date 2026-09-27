// Renders any filtered admin list as a PDF on the school letterhead.
// The work lives in the shared factory; the CMS mounts the same handler.
import { createTablePdfHandler } from "@nkps/shared/lib/table-pdf-handler";

export const runtime = "nodejs";

export const POST = createTablePdfHandler({ sourceApp: "erp" });
