/** Shared so GameCanvas, Avatars, Minimap and the HUD can all read it without
 *  importing each other — a cycle here can hit the const TDZ and crash the
 *  whole canvas at startup. */
export const PLAYER_COLORS = ["#f87171", "#60a5fa", "#facc15", "#c084fc", "#34d399", "#fb923c"];
