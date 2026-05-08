import { statusPillStyle } from "@/lib/obs-styles";

export function StatusPill({ status }: { status: string }) {
  return <span style={statusPillStyle(status)}>{status}</span>;
}
