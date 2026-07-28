/* Collapsible sidebar groups. Each `.group` has a `.group-header` toggle and a
 * `.group-body`; clicking the header collapses/expands the body. Groups start
 * hidden (inline display:none) until their prerequisite is met, then modules
 * call revealGroup() to show + expand them. This keeps the panel short as more
 * tools are added — only the relevant group is open at any time. */

function setExpanded(group, expanded) {
  group.classList.toggle('collapsed', !expanded);
  const header = group.querySelector('.group-header');
  if (header) header.setAttribute('aria-expanded', String(expanded));
}

/** Make a hidden group visible (does not change its collapsed state). */
export function showGroup(id) {
  const g = document.getElementById(id);
  if (g) g.style.display = '';
}

/** Expand a group's body (if collapsed). */
export function expandGroup(id) {
  const g = document.getElementById(id);
  if (g) setExpanded(g, true);
}

/** Show a hidden group and expand it — used on progressive disclosure. */
export function revealGroup(id) {
  showGroup(id);
  expandGroup(id);
}

export function initPanel() {
  document.querySelectorAll('.group').forEach(group => {
    const header = group.querySelector('.group-header');
    if (!header) return;
    header.addEventListener('click', () => {
      setExpanded(group, group.classList.contains('collapsed'));
    });
  });
}
