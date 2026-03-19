import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MANAGED_DIR = join(__dirname, "managed", "leaf");
