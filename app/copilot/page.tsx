import { redirect } from "next/navigation";

/**
 * Legacy Copilot route.
 */
export default function CopilotPage() {
  redirect("/chat");
}
