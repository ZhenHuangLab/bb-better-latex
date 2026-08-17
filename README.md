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
| `\[...\]` or a lone line `[ \mathbf q = ... ]` | display math. Markdown eats `\[` into `[`. Closers inside `\right]` / `\sqrt[n]` are not treated as the end of the formula |
| `\(...\)` or leftover `(f(\mathbf r))`, `(R_i)` | inline, only with a TeX command, `^`, or a short subscript. Bare `(i)` / `(optional)` stay text |
| `$5 to $10`, `$HOME`, `$PATH` | left as text |

It is **not** “formulas at the start of a line fail.” A line such as

```md
$\mathbf{c}0 = (c{0,x},; c_{0,z})$ 是 degree-0（常数项）系数。
```

fails in a naïve scanner because markdown splits `{0,x}` / `_{0,z}` into extra DOM nodes, so no single text node contains both `$`. This plugin concatenates each paragraph and replaces the whole range.

## Limits

- Math inside `` `code` `` or fenced blocks stays literal.
- Markdown treats `\[` / `\(` as escaped brackets, so the DOM usually has `[...]` / `(...)`. The plugin recovers those when the body looks like TeX.
- Prefer `$...$` / `$$...$$` when you control the source.
- Unclosed `$` while a message is still streaming stays literal until the closer arrives.

## License

MIT
