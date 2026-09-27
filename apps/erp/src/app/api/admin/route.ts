import { createAdminProxyHandler } from "@nkps/shared/lib/admin-proxy";
import {
  TABLE_FEATURE_KEY,
  ALLOWED_COLUMNS,
  EDITOR_RESTRICTED_ACTIONS,
  COLUMN_SCOPED_FEATURE_KEYS,
} from "@/lib/admin-tables";

export const POST = createAdminProxyHandler({
  tableFeatureKey: TABLE_FEATURE_KEY,
  allowedColumns: ALLOWED_COLUMNS,
  editorRestrictedActions: EDITOR_RESTRICTED_ACTIONS,
  columnScopedFeatureKeys: COLUMN_SCOPED_FEATURE_KEYS,
});
