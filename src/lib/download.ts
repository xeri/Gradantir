/**
 * Hand a file back to the user.
 *
 * Every place this is called from is a data-loss path — a book that would not
 * parse, a book that cannot be written, a board that threw while drawing. The
 * answer in all three is the same: a file on disk is the only copy here that
 * outlives the browser, so offer it before offering anything else.
 */
export function downloadText(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not immediately: Firefox cancels an in-flight
  // download if the object URL dies in the same frame as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
