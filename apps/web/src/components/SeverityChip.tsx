import { Badge } from "@/components/Badge";

export function SeverityChip({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  if (s === "hard") return <Badge label="hard" status="REJECTED_BY_RULE" />;
  if (s === "soft") return <Badge label="soft" status="REVIEW_REQUIRED" />;
  return <Badge label={severity} />;
}
