# Layer names

This page covers what AutoCAD does with the characters in a layer name, and
what `lint` checks because of it. [Rules](rules.md) lists the other rules for layer names.

## Linetype names

AutoCAD holds linetype names to the rules of layer names and compares them the
same way, so this page applies to linetype names too. `DASHED` and `dashed` are
one linetype. Linetype names follow the R2018 layer-name rules, because an R12
drawing cannot define a linetype.

## Text style names

Text style names follow the rules of layer names and are compared the same way, so this page
applies to them too. `NOTES` and `notes` are one text style.

## Layer names and case

AutoCAD lower-cases a layer name one character at a time, from a table of its
own that is older and smaller than Unicode's. An entity on `mixedcase`, `café`,
`αβγ` or `СЛОЙ` goes on a layer declared as `MixedCase`, `CAFÉ`, `ΑΒΓ` or `Слой`,
and `lint` accepts it. AutoCAD does not pair these, and `lint` reports the
entity's layer as undefined:

- `ΟΔΟΣ` and `οδος`, because of the final sigma `ς`. `οδοσ` does match.
- `STRASSE` and `straße`, and `TITLE` and `tıtle` with a dotless `ı`.
- `Ÿ` and `ÿ`, `İ` and `i`, and the title-case digraphs such as `ǅ`.
- Georgian, Cherokee and most other letters that gained a case after Unicode
  5.1.

Where `AUDIT` would take the entity's spelling for the declared layer's, as it
does for `STRASSE` and `straße`, the message says so. AutoCAD adds a layer for
the entity, and `AUDIT` then reports a duplicate name.

## Layer names that AUDIT calls duplicates

AutoCAD's `AUDIT` compares layer names another way than AutoCAD looks them up.
It reports "Duplicate name" for some pairs of layers that AutoCAD keeps as two.
`lint` reports the second layer of such a pair as a duplicate, which is an
error, for these kinds of pair. Each kind holds in either letter case and
inside a longer name, so `Hauptstraße 12` and `HAUPTSTRASSE 12` are a pair.

- Single letters: `σ` and `ς`, `Ÿ` and `ÿ`, `ß` and `ẞ`, a title-case digraph
  such as `ǅ` and `ǆ`, and a few others.
- A letter and the letters it stands for: `ß` and `ss`, `æ` and `ae`, `œ` and
  `oe`, `ĳ` and `ij`, `þ` and `th`, `ǆ` and `dž`, `ǉ` and `lj`, `ǌ` and `nj`,
  `ǳ` and `dz`, the ligatures `ﬀ`, `ﬁ`, `ﬂ`, `ﬃ`, `ﬄ` and `ﬆ`, and `ȸ`, `ȹ`,
  `ʪ`, `ʫ`, `ꜳ`, `ꜵ`, `ꜷ`, `ꜹ`, `ꜽ`, `ꝏ` and `ᴂ`.
- A composed character and its decomposed form, such as `é` and an `e` with a
  combining acute accent, with its marks in any order Unicode counts as the
  same, such as a dot below before or after a circumflex. Hangul syllables are
  an exception, and so are 40 Arabic, Indic, Myanmar, kana, Hebrew and CJK
  compatibility characters: `AUDIT` keeps those apart from their decomposed
  forms.
- A name with a soft hyphen, U+00AD, inside it or in front of it, and the same
  name without.

`AUDIT` reports more pairs than these, so a drawing that passes `lint` can still
get a "Duplicate name" from `AUDIT`. The rule is kept narrow so that `lint` does
not report a pair that `AUDIT` accepts. What it leaves out:

- A name that ends with a soft hyphen and the same name without it, and a soft
  hyphen in front of a combining mark or a Hangul jamo. `AUDIT` reports some of
  those pairs and not others. It does not report `coop` and `coop` followed by a
  soft hyphen. Two names that both end with a soft hyphen are compared like any
  others.
- Compatibility characters that `AUDIT` takes for their plain forms, such as a
  modifier letter `ʰ` and `h`, `㎏` and `kg`, and Arabic presentation forms.
- Characters that `AUDIT` cannot tell from an unassigned one, such as `Ԥ`,
  U+0524, and `Ꙡ`, U+A660. Two names that differ only in such characters are
  duplicates to it.

## Layer name characters

AutoCAD refuses these characters in a layer name, so `lint` does too. Over any
of them but the last row's, AutoCAD discards the whole drawing. All are outside
ASCII, so they only concern R2018 drawings.

| Characters                                                                 | What they are                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| U+0080 to U+009F                                                           | C1 control characters                                      |
| U+0600 to U+0603, U+06DD, U+070F, U+17B4, U+17B5                           | Arabic, Syriac and Khmer formatting characters             |
| U+200B to U+200F, U+202A to U+202E, U+2060 to U+2064, U+206A to U+206F     | Zero-width spaces and joiners, and text direction controls |
| U+FEFF, U+FFF9 to U+FFFB                                                   | The byte order mark and annotation characters              |
| U+2071, U+207F, U+2090 to U+2094                                           | Superscript and subscript letters                          |
| Letters in U+2102 to U+214E, such as `ℓ`, `ℕ`, the ohm sign and the kelvin | Letterlike symbols. Use the Greek `Ω`, U+03A9, for ohms.   |
| U+2180 to U+2188                                                           | Roman numeral characters                                   |
| U+2C00 to U+2C5E, except U+2C2F                                            | Glagolitic                                                 |
| U+2C60 to U+2C7D, except U+2C70                                            | Latin Extended-C                                           |
| U+2C80 to U+2CE4                                                           | Coptic                                                     |
| U+2D00 to U+2D25                                                           | Georgian Supplement                                        |
| U+2D30 to U+2D65, U+2D6F                                                   | Tifinagh                                                   |
| Letters in U+2D80 to U+2DDE                                                | Ethiopic Extended                                          |
| U+E800 to U+E8FF                                                           | Private use. AutoCAD replaces these and keeps the drawing. |

[`src/layers.ts`](../src/layers.ts) has the exact list.
