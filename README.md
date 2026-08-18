# Better LaTeX

BB’s chat markdown turns **single-dollar** `$...$` off on purpose (`#511`): `$5 to $10` and `$HOME` were being typeset as math. The stock renderer only accepts `$$...$$`.

This plugin walks rendered chat (`[data-markdown-preview]`) and typesets the delimiters models actually emit.

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
| `\[...\]` or a lone line `[ \mathbf q = ... ]` | display math. Nested `[` from `\log[...]`, `\left[`, asymmetric `\right]`, or `[X_i; X_j]` no longer cut the formula short |
| `\(...\)` or leftover `(L_x,L_y)`, `(T)`, `(T>0)` | inline. Markdown eats `\(` into `(`. `(optional)` / `(user_id)` stay text |
| a whole paragraph like `T=e^\tau, \qquad \tau=\texttt{log_scale}.` or `\begin{aligned}...\end{aligned}` | display math, when it is TeX-only (no Chinese / English prose). Markdown-swallowed conjugate stars and aligned row breaks are recovered |
| `$5 to $10`, `$HOME`, `$PATH` | left as text |

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
