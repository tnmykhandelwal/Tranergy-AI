import { prisma } from "../db";

export interface CertificateCheckResult {
  externalId: string;
  status: string;
  usable: boolean;
  quantityMwh: number | null;
  issues: string[];
  usedByClaimIds: string[];
}

export async function checkCertificate(
  externalId: string,
  claimKwh?: number,
  excludeClaimId?: string,
): Promise<CertificateCheckResult> {
  const record = await prisma.certificateRecord.findUnique({ where: { externalId } });

  if (!record) {
    return {
      externalId,
      status: "UNKNOWN",
      usable: false,
      quantityMwh: null,
      issues: ["CERTIFICATE_NOT_FOUND"],
      usedByClaimIds: [],
    };
  }

  const usedClaims = await prisma.generationClaim.findMany({
    where: {
      certificateExternalId: externalId,
      status: { not: "REJECTED_BY_RULE" },
      ...(excludeClaimId ? { id: { not: excludeClaimId } } : {}),
    },
    select: { id: true },
  });
  const usedByClaimIds = usedClaims.map((c) => c.id);

  const issues: string[] = [];
  if (record.status === "INVALID") issues.push("CERTIFICATE_INVALID");
  if (record.status === "TRANSFERRED") issues.push("CERTIFICATE_TRANSFERRED");
  if (record.status === "RETIRED") issues.push("CERTIFICATE_RETIRED");
  if (usedByClaimIds.length > 0) issues.push("CERTIFICATE_DUPLICATE_USE");
  if (claimKwh !== undefined && record.quantityMwh * 1000 < claimKwh) {
    issues.push("CERTIFICATE_QUANTITY_TOO_SMALL");
  }

  const usable = record.status === "ACTIVE" && issues.length === 0;

  return {
    externalId,
    status: record.status,
    usable,
    quantityMwh: record.quantityMwh,
    issues,
    usedByClaimIds,
  };
}
