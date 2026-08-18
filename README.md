# Better LaTeX

BB’s chat markdown turns **single-dollar** `$...$` off on purpose (`#511`): `$5 to $10` and `$HOME` were being typeset as math. The stock renderer only accepts `$$...$$`.

This plugin walks rendered chat (`[data-markdown-preview]`) and typesets the delimiters models actually emit. Text selections that include rendered math are serialized back to canonical `\(...\)` / `\[...\]` source, so **Add to chat** and **Reply in side chat** quote LaTeX instead of KaTeX's visual DOM text.

## Install

```sh
bb plugin install git:https://github.com/ZhenHuangLab/bb-better-latex.git
```

Or from a local checkout:

```sh
npm install
bb plugin install .
```

Then refresh the BB app. Disable with `bb plugin disable bb-better-latex`.

## What renders

| Source | Result |
| --- | --- |
| `$x$`, `$E=mc^2$`, `$\mathbf{c}_0$` | inline KaTeX |
| `$$ ... $$` on its own lines | display math (host already does this) |
| leftover `$$x$$` in a paragraph | inline, if the host left it as text |
| `\[...\]` or a lone line `[ \mathbf q = ... ]`, including short equations like `[ m=0. ]` | display math. Nested `[` from `\log[...]`, `\left[`, asymmetric `\right]`, or `[X_i; X_j]` no longer cut the formula short |
| `\(...\)` or leftover `(L_x,L_y)`, `(T)`, `(T>0)`, `(1/L)` | inline. Markdown eats `\(` into `(`. `(optional)` / `(user_id)` and plain numeric `(1/2)` stay text |
| a whole paragraph like `T=e^\tau, \qquad \tau=\texttt{log_scale}.` or `\begin{aligned}...\end{aligned}` | display math, when it is TeX-only (no Chinese / English prose). Markdown-swallowed conjugate stars and aligned row breaks are recovered |
| matrix-family environments such as `\begin{bmatrix}g_1\\g_2\\g_3\end{bmatrix}` | matrix rows stay vertical when Markdown collapses each `\\` to `\` |
| `$5 to $10`, `$HOME`, `$PATH` | left as text |

## Quoting rendered math

When a selection includes plugin-rendered or stock BB KaTeX, the quoted text uses canonical delimiters:

```md
The result is \(m=0\), so
\[
|k-k'|=\frac{1}{L}.
\]
```

This applies to both **Add to chat** and **Reply in side chat**, because BB snapshots both actions from the same browser selection. Selecting only part of a rendered formula intentionally quotes the whole formula; a partial KaTeX DOM subtree is not valid LaTeX. Pure-text selections are unchanged.

It is **not** “formulas at the start of a line fail.” A line such as

```md
$\mathbf{c}0 = (c{0,x},; c_{0,z})$ 是 degree-0（常数项）系数。
```

fails in a naïve scanner because markdown splits `{0,x}` / `_{0,z}` into extra DOM nodes, so no single text node contains both `$`. This plugin projects each markdown block—including `<br>` line breaks—before replacing the exact source range. It also reconstructs display formulas that markdown split into adjacent paragraphs or Setext headings when `=` appears on its own line.

## Limits

- Math inside `` `code` ``, fenced blocks, existing KaTeX, or editable elements stays literal and is never crossed by a replacement range.
- Markdown treats `\[` / `\(` as escaped brackets, so the DOM usually has `[...]` / `(...)`. The plugin recovers those when the body looks like TeX.
- Prefer `$...$` / `$$...$$` when you control the source.
- Unclosed `$` while a message is still streaming stays literal until the closer arrives.
- If KaTeX still rejects malformed TeX, the plugin leaves the original source visible instead of replacing it with an error block.

## License

MIT
