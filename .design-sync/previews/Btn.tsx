import { Plus, Settings2, Trash2 } from "lucide-react";
import { Btn } from "grade-exchange";

/* Cards render on white; the desk is near-black. Every cell supplies its own
   surface, exactly as the conventions header tells the design agent to. */
const desk = {
  background: "#0F131A",
  border: "1px solid #1F2733",
  padding: 16,
  color: "#DFE5EC",
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap" as const,
};

/** The three weights side by side — the axis that most changes appearance. */
export const Variants = () => (
  <div style={desk}>
    <Btn variant="primary">LOG RESULT</Btn>
    <Btn>SUBJECT</Btn>
    <Btn variant="danger">DELIST</Btn>
  </div>
);

/** The app's own header row: ghost actions with a filled amber key. */
export const DeskActions = () => (
  <div style={desk}>
    <Btn><Plus size={12} /> Subject</Btn>
    <Btn variant="primary"><Plus size={12} /> Log result</Btn>
    <Btn aria-label="Desk settings"><Settings2 size={13} /></Btn>
  </div>
);

/** Destructive confirm pair, as the drawer files it. */
export const Danger = () => (
  <div style={desk}>
    <Btn variant="danger"><Trash2 size={12} /> Delete result</Btn>
    <Btn>Cancel</Btn>
  </div>
);

/** Disabled reads as dimmed, not as a different variant. */
export const Disabled = () => (
  <div style={desk}>
    <Btn variant="primary" disabled>LOG RESULT</Btn>
    <Btn disabled>SUBJECT</Btn>
    <Btn variant="danger" disabled>DELIST</Btn>
  </div>
);
