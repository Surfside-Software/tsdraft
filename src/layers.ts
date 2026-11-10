// What AutoCAD 2025 does with layer names: which characters it refuses, which
// names it takes for the same layer, and where layer "0" must sit. Every table
// here was found by opening tsdraft's output in AutoCAD 2025, and
// `pnpm test:cad` checks each one against AutoCAD again.
import type { Layer } from "./drawing.ts";

// AutoCAD discards a drawing whose layer table has a name with one of the
// characters below, as it does for the ASCII punctuation `rules.ts` lists. The
// exception is the private-use block, which it replaces with `\M+00000`. They
// are string literals, with every character written as an escape, so that
// `rules.ts` can also reject them in a layer name written as a literal.

/** C1 controls and invisible formatting characters, such as the zero-width space. */
export const REJECTED_FORMAT =
  "\
\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087\u0088\u0089\u008a\u008b\u008c\u008d\u008e\
\u008f\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097\u0098\u0099\u009a\u009b\u009c\u009d\
\u009e\u009f\u0600\u0601\u0602\u0603\u06dd\u070f\u17b4\u17b5\u200b\u200c\u200d\u200e\u200f\
\u202a\u202b\u202c\u202d\u202e\u2060\u2061\u2062\u2063\u2064\u206a\u206b\u206c\u206d\u206e\
\u206f\ufeff\ufff9\ufffa\ufffb";

/** Superscript and subscript letters, Roman numeral characters and letterlike symbols such as the ohm sign. */
export const REJECTED_LETTERLIKE =
  "\
\u2071\u207f\u2090\u2091\u2092\u2093\u2094\u2102\u2107\u210a\u210b\u210c\u210d\u210e\u210f\
\u2110\u2111\u2112\u2113\u2115\u2119\u211a\u211b\u211c\u211d\u2124\u2126\u2128\u212a\u212b\
\u212c\u212d\u212f\u2130\u2131\u2132\u2133\u2134\u2135\u2136\u2137\u2138\u2139\u213c\u213d\
\u213e\u213f\u2145\u2146\u2147\u2148\u2149\u214e\u2180\u2181\u2182\u2183\u2184\u2185\u2186\
\u2187\u2188";

/** Glagolitic letters and the Latin Extended-C block. */
export const REJECTED_GLAGOLITIC =
  "\
\u2c00\u2c01\u2c02\u2c03\u2c04\u2c05\u2c06\u2c07\u2c08\u2c09\u2c0a\u2c0b\u2c0c\u2c0d\u2c0e\
\u2c0f\u2c10\u2c11\u2c12\u2c13\u2c14\u2c15\u2c16\u2c17\u2c18\u2c19\u2c1a\u2c1b\u2c1c\u2c1d\
\u2c1e\u2c1f\u2c20\u2c21\u2c22\u2c23\u2c24\u2c25\u2c26\u2c27\u2c28\u2c29\u2c2a\u2c2b\u2c2c\
\u2c2d\u2c2e\u2c30\u2c31\u2c32\u2c33\u2c34\u2c35\u2c36\u2c37\u2c38\u2c39\u2c3a\u2c3b\u2c3c\
\u2c3d\u2c3e\u2c3f\u2c40\u2c41\u2c42\u2c43\u2c44\u2c45\u2c46\u2c47\u2c48\u2c49\u2c4a\u2c4b\
\u2c4c\u2c4d\u2c4e\u2c4f\u2c50\u2c51\u2c52\u2c53\u2c54\u2c55\u2c56\u2c57\u2c58\u2c59\u2c5a\
\u2c5b\u2c5c\u2c5d\u2c5e\u2c60\u2c61\u2c62\u2c63\u2c64\u2c65\u2c66\u2c67\u2c68\u2c69\u2c6a\
\u2c6b\u2c6c\u2c6d\u2c6e\u2c6f\u2c71\u2c72\u2c73\u2c74\u2c75\u2c76\u2c77\u2c78\u2c79\u2c7a\
\u2c7b\u2c7c\u2c7d";

/** Coptic letters. */
export const REJECTED_COPTIC =
  "\
\u2c80\u2c81\u2c82\u2c83\u2c84\u2c85\u2c86\u2c87\u2c88\u2c89\u2c8a\u2c8b\u2c8c\u2c8d\u2c8e\
\u2c8f\u2c90\u2c91\u2c92\u2c93\u2c94\u2c95\u2c96\u2c97\u2c98\u2c99\u2c9a\u2c9b\u2c9c\u2c9d\
\u2c9e\u2c9f\u2ca0\u2ca1\u2ca2\u2ca3\u2ca4\u2ca5\u2ca6\u2ca7\u2ca8\u2ca9\u2caa\u2cab\u2cac\
\u2cad\u2cae\u2caf\u2cb0\u2cb1\u2cb2\u2cb3\u2cb4\u2cb5\u2cb6\u2cb7\u2cb8\u2cb9\u2cba\u2cbb\
\u2cbc\u2cbd\u2cbe\u2cbf\u2cc0\u2cc1\u2cc2\u2cc3\u2cc4\u2cc5\u2cc6\u2cc7\u2cc8\u2cc9\u2cca\
\u2ccb\u2ccc\u2ccd\u2cce\u2ccf\u2cd0\u2cd1\u2cd2\u2cd3\u2cd4\u2cd5\u2cd6\u2cd7\u2cd8\u2cd9\
\u2cda\u2cdb\u2cdc\u2cdd\u2cde\u2cdf\u2ce0\u2ce1\u2ce2\u2ce3\u2ce4";

/** Georgian Supplement, Tifinagh and Ethiopic Extended letters. */
export const REJECTED_GEORGIAN =
  "\
\u2d00\u2d01\u2d02\u2d03\u2d04\u2d05\u2d06\u2d07\u2d08\u2d09\u2d0a\u2d0b\u2d0c\u2d0d\u2d0e\
\u2d0f\u2d10\u2d11\u2d12\u2d13\u2d14\u2d15\u2d16\u2d17\u2d18\u2d19\u2d1a\u2d1b\u2d1c\u2d1d\
\u2d1e\u2d1f\u2d20\u2d21\u2d22\u2d23\u2d24\u2d25\u2d30\u2d31\u2d32\u2d33\u2d34\u2d35\u2d36\
\u2d37\u2d38\u2d39\u2d3a\u2d3b\u2d3c\u2d3d\u2d3e\u2d3f\u2d40\u2d41\u2d42\u2d43\u2d44\u2d45\
\u2d46\u2d47\u2d48\u2d49\u2d4a\u2d4b\u2d4c\u2d4d\u2d4e\u2d4f\u2d50\u2d51\u2d52\u2d53\u2d54\
\u2d55\u2d56\u2d57\u2d58\u2d59\u2d5a\u2d5b\u2d5c\u2d5d\u2d5e\u2d5f\u2d60\u2d61\u2d62\u2d63\
\u2d64\u2d65\u2d6f\u2d80\u2d81\u2d82\u2d83\u2d84\u2d85\u2d86\u2d87\u2d88\u2d89\u2d8a\u2d8b\
\u2d8c\u2d8d\u2d8e\u2d8f\u2d90\u2d91\u2d92\u2d93\u2d94\u2d95\u2d96\u2da0\u2da1\u2da2\u2da3\
\u2da4\u2da5\u2da6\u2da8\u2da9\u2daa\u2dab\u2dac\u2dad\u2dae\u2db0\u2db1\u2db2\u2db3\u2db4\
\u2db5\u2db6\u2db8\u2db9\u2dba\u2dbb\u2dbc\u2dbd\u2dbe\u2dc0\u2dc1\u2dc2\u2dc3\u2dc4\u2dc5\
\u2dc6\u2dc8\u2dc9\u2dca\u2dcb\u2dcc\u2dcd\u2dce\u2dd0\u2dd1\u2dd2\u2dd3\u2dd4\u2dd5\u2dd6\
\u2dd8\u2dd9\u2dda\u2ddb\u2ddc\u2ddd\u2dde";

/** The private-use characters U+E800 to U+E8FF. */
export const REJECTED_PRIVATE =
  "\
\ue800\ue801\ue802\ue803\ue804\ue805\ue806\ue807\ue808\ue809\ue80a\ue80b\ue80c\ue80d\ue80e\
\ue80f\ue810\ue811\ue812\ue813\ue814\ue815\ue816\ue817\ue818\ue819\ue81a\ue81b\ue81c\ue81d\
\ue81e\ue81f\ue820\ue821\ue822\ue823\ue824\ue825\ue826\ue827\ue828\ue829\ue82a\ue82b\ue82c\
\ue82d\ue82e\ue82f\ue830\ue831\ue832\ue833\ue834\ue835\ue836\ue837\ue838\ue839\ue83a\ue83b\
\ue83c\ue83d\ue83e\ue83f\ue840\ue841\ue842\ue843\ue844\ue845\ue846\ue847\ue848\ue849\ue84a\
\ue84b\ue84c\ue84d\ue84e\ue84f\ue850\ue851\ue852\ue853\ue854\ue855\ue856\ue857\ue858\ue859\
\ue85a\ue85b\ue85c\ue85d\ue85e\ue85f\ue860\ue861\ue862\ue863\ue864\ue865\ue866\ue867\ue868\
\ue869\ue86a\ue86b\ue86c\ue86d\ue86e\ue86f\ue870\ue871\ue872\ue873\ue874\ue875\ue876\ue877\
\ue878\ue879\ue87a\ue87b\ue87c\ue87d\ue87e\ue87f\ue880\ue881\ue882\ue883\ue884\ue885\ue886\
\ue887\ue888\ue889\ue88a\ue88b\ue88c\ue88d\ue88e\ue88f\ue890\ue891\ue892\ue893\ue894\ue895\
\ue896\ue897\ue898\ue899\ue89a\ue89b\ue89c\ue89d\ue89e\ue89f\ue8a0\ue8a1\ue8a2\ue8a3\ue8a4\
\ue8a5\ue8a6\ue8a7\ue8a8\ue8a9\ue8aa\ue8ab\ue8ac\ue8ad\ue8ae\ue8af\ue8b0\ue8b1\ue8b2\ue8b3\
\ue8b4\ue8b5\ue8b6\ue8b7\ue8b8\ue8b9\ue8ba\ue8bb\ue8bc\ue8bd\ue8be\ue8bf\ue8c0\ue8c1\ue8c2\
\ue8c3\ue8c4\ue8c5\ue8c6\ue8c7\ue8c8\ue8c9\ue8ca\ue8cb\ue8cc\ue8cd\ue8ce\ue8cf\ue8d0\ue8d1\
\ue8d2\ue8d3\ue8d4\ue8d5\ue8d6\ue8d7\ue8d8\ue8d9\ue8da\ue8db\ue8dc\ue8dd\ue8de\ue8df\ue8e0\
\ue8e1\ue8e2\ue8e3\ue8e4\ue8e5\ue8e6\ue8e7\ue8e8\ue8e9\ue8ea\ue8eb\ue8ec\ue8ed\ue8ee\ue8ef\
\ue8f0\ue8f1\ue8f2\ue8f3\ue8f4\ue8f5\ue8f6\ue8f7\ue8f8\ue8f9\ue8fa\ue8fb\ue8fc\ue8fd\ue8fe\
\ue8ff";

const REJECTED: ReadonlySet<string> = new Set(
  REJECTED_FORMAT +
    REJECTED_LETTERLIKE +
    REJECTED_GLAGOLITIC +
    REJECTED_COPTIC +
    REJECTED_GEORGIAN +
    REJECTED_PRIVATE,
);

/**
 * Finds the first character of a layer name that AutoCAD rejects, beyond the
 * ASCII punctuation and control characters that `layerNameProblem` checks.
 *
 * @param name - The layer name.
 * @returns The character, or undefined when the name has none.
 */
export function rejectedNameCharacter(name: string): string | undefined {
  for (const character of name) if (REJECTED.has(character)) return character;
  return undefined;
}

/**
 * The capital letters AutoCAD lower-cases when it looks a layer name up, as
 * hexadecimal code point ranges. `/2` marks a range that takes every second
 * code point. AutoCAD's table is older and smaller than Unicode's: it leaves
 * out Ÿ (U+0178), İ (U+0130) and ϴ (U+03F4), the title-case digraphs such as
 * ǅ (U+01C5), and most letters added since Unicode 5.1.
 */
const FOLDED_RANGES =
  "41-5a c0-d6 d8-de 100-12e/2 132-136/2 139-147/2 14a-176/2 179-17d/2 181-182 184-186/2 " +
  "187-189/2 18a-18b 18e-191 193-194 196-198 19c-19d 19f-1a0 1a2-1a6/2 1a7-1a9/2 1ac-1ae/2 " +
  "1af-1b1/2 1b2-1b3 1b5-1b7/2 1b8 1bc 1c4 1c7 1ca 1cd-1db/2 1de-1ee/2 1f1 1f4-1f6/2 " +
  "1f7-1f8 1fa-232/2 23b-23d/2 241-243/2 244-246 248-24e/2 370-372/2 376 386-388/2 389-38a " +
  "38c-38e/2 38f-391/2 392-3a1 3a3-3ab 3cf 3d8-3ee/2 3f7-3f9/2 3fa 3fd-42f 460-480/2 " +
  "48a-4c0/2 4c1-4cd/2 4d0-522/2 531-556 1e00-1e94/2 1ea0-1efe/2 1f08-1f0f 1f18-1f1d " +
  "1f28-1f2f 1f38-1f3f 1f48-1f4d 1f59-1f5f/2 1f68-1f6f 1f88-1f8f 1f98-1f9f 1fa8-1faf " +
  "1fb8-1fbc 1fc8-1fcc 1fd8-1fdb 1fe8-1fec 1ff8-1ffc 2160-216f 24b6-24cf a640-a65e/2 " +
  "a662-a66c/2 a680-a696/2 a722-a72e/2 a732-a76e/2 a779-a77d/2 a77e-a786/2 a78b ff21-ff3a";

const FOLDED: ReadonlySet<number> = new Set(
  FOLDED_RANGES.split(" ").flatMap((range) => {
    const [span = "", step = "1"] = range.split("/");
    const [first = "", last = first] = span.split("-");
    const codes: number[] = [];
    for (let code = parseInt(first, 16); code <= parseInt(last, 16); code += Number(step)) {
      codes.push(code);
    }
    return codes;
  }),
);

/**
 * Pairs of letters that AutoCAD keeps as two layers but its AUDIT reports as a
 * duplicate name, written `from>to` in hexadecimal after `layerKey` has
 * lower-cased the name. They include the two lower-case sigmas σ and ς.
 */
const AUDIT_SAME_PAIRS =
  "178>ff 1c6>1c5 1c9>1c8 1cc>1cb 1f3>1f2 3c3>3c2 3f5>3b5 527>526 1e9e>df 1fbe>3b9 " +
  "2c7e>23f 2c7f>240 2cec>2ceb 2cee>2ced a791>a790 a7a1>a7a0 a7a3>a7a2 a7a5>a7a4 " +
  "a7a7>a7a6 a7a9>a7a8";

const AUDIT_SAME: ReadonlyMap<string, string> = new Map(
  AUDIT_SAME_PAIRS.split(" ").map((pair): [string, string] => {
    const [from = "", to = ""] = pair.split(">");
    return [String.fromCharCode(parseInt(from, 16)), String.fromCharCode(parseInt(to, 16))];
  }),
);

/**
 * Letters that AUDIT takes for the two or three letters they stand for, in
 * either letter case: it reports `straße` and `STRASSE` as a duplicate name,
 * and `Þórr` and `Thórr`. Each is listed in lower case, as `layerKey` leaves
 * it, with a title-case digraph beside its lower-case form.
 */
const AUDIT_SPELLED_OUT: ReadonlyMap<string, string> = new Map(
  Object.entries({
    ß: "ss",
    ẞ: "ss",
    æ: "ae",
    ᴂ: "ae",
    œ: "oe",
    ĳ: "ij",
    þ: "th",
    ǆ: "dž",
    ǅ: "dž",
    ǉ: "lj",
    ǈ: "lj",
    ǌ: "nj",
    ǋ: "nj",
    ǳ: "dz",
    ǲ: "dz",
    ﬀ: "ff",
    ﬁ: "fi",
    ﬂ: "fl",
    ﬃ: "ffi",
    ﬄ: "ffl",
    ﬆ: "st",
    ȸ: "db",
    ȹ: "qp",
    ʪ: "ls",
    ʫ: "lz",
    ꜳ: "aa",
    ꜵ: "ao",
    ꜷ: "au",
    ꜹ: "av",
    ꜽ: "ay",
    ꝏ: "oo",
    // The key is compared in decomposed form, so `ž` is spelled as it decomposes.
  }).map(([letter, spelling]) => [letter, spelling.normalize("NFD")]),
);

/**
 * Composed characters that AUDIT does not take for their decomposed forms,
 * though Unicode calls the two equivalent: Hangul syllables, and some Arabic,
 * Indic, Myanmar, kana, Hebrew and CJK compatibility characters. AUDIT takes
 * every other composed character below U+10000 for its decomposed form.
 */
const KEPT_COMPOSED =
  /([\u0622-\u0624\u0626\u06c0\u06c2\u06d3\u09cb\u09cc\u09df\u0b48\u0b4b\u0b4c\u0b94\u0bca-\u0bcc\u0c48\u0cc0\u0cc7\u0cc8\u0cca\u0ccb\u0d4a-\u0d4c\u0dda\u0ddc-\u0dde\u1026\u309e\u30fe\ufa2e\ufa2f\ufa6b\ufa6d\ufb1f\ufb2c\ufb2d\uac00-\ud7a3])/;

const SOFT_HYPHEN = "\u00ad";

/**
 * Soft hyphens that AUDIT ignores. It does not ignore one in front of a
 * combining mark or a Hangul jamo: `E`, a soft hyphen and a combining acute
 * accent are not É to it.
 */
const IGNORED_SOFT_HYPHENS = /\u00ad+(?![\u00ad\p{M}\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff])/gu;

/**
 * The form of a layer name that AutoCAD looks layers up by. Two names with the
 * same key are one layer to AutoCAD: an entity on `wall` goes on a layer
 * declared as `WALL`, and AutoCAD keeps only the first of two such layers.
 *
 * AutoCAD lower-cases one character at a time from its own table, so this is
 * not `toLowerCase()`: a final sigma ς, a dotless ı and ß stay as they are.
 *
 * @param name - The layer name.
 * @returns The key to compare layer names by.
 */
export function layerKey(name: string): string {
  let key = "";
  for (let i = 0; i < name.length; i++) {
    const character = name.charAt(i);
    key += FOLDED.has(name.charCodeAt(i)) ? character.toLowerCase() : character;
  }
  return key;
}

/**
 * The form of a layer name that AutoCAD's AUDIT compares when it looks for
 * duplicate names. AUDIT takes more names for the same than the layer table
 * does, so two layers can have different `layerKey`s and still be an AUDIT
 * error. Two names with the same key here are such a pair, unless they have
 * the same `layerKey` too.
 *
 * The key follows the kinds of pair measured in AutoCAD 2025:
 *
 * - A few single letters, such as σ and ς.
 * - A letter and the letters it stands for, such as ß and `ss`.
 * - A composed character and its decomposed form, such as é and `e` with a
 *   combining acute accent, with its marks in any order Unicode counts as the
 *   same, such as a dot below before or after a circumflex.
 * - A name with a soft hyphen inside it or in front of it and the same name
 *   without.
 *
 * It is not AUDIT's whole comparison. AUDIT also takes some compatibility
 * characters for their plain forms, and cannot tell two characters apart when
 * it knows neither.
 *
 * @param name - The layer name.
 * @returns The key to find AUDIT's duplicate names by.
 */
export function layerAuditKey(name: string): string {
  let key = "";
  for (const character of layerKey(decomposed(name.replace(IGNORED_SOFT_HYPHENS, "")))) {
    key += AUDIT_SPELLED_OUT.get(character) ?? AUDIT_SAME.get(character) ?? character;
  }
  // AUDIT does not report `coop` and `coop` with a soft hyphen after it as duplicates, though it
  // does report some other pairs that differ by a soft hyphen at the end. A mark for one at the
  // end keeps a name that ends with a soft hyphen apart from every name that does not. Two names
  // that both end with one are compared like any others, as the pairs in `auditPairs` in
  // `scripts/cad-check.ts` check.
  return name.endsWith(SOFT_HYPHEN) ? key + SOFT_HYPHEN : key;
}

/** Decomposes every composed character that AUDIT takes for its decomposed form. */
function decomposed(name: string): string {
  return name
    .split(KEPT_COMPOSED)
    .map((part, i) => (i % 2 === 1 ? part : part.normalize("NFD")))
    .join("");
}

/**
 * Orders layers for a DXF layer table. AutoCAD's AUDIT reports "Layer zero name
 * found at incorrect index" when layer `0` is not the first record.
 *
 * @param layers - The drawing's layers, in any order.
 * @returns The layers with `0` first and the others in their given order.
 */
export function layerZeroFirst(layers: readonly Layer[]): readonly Layer[] {
  return [...layers.filter((l) => l.name === "0"), ...layers.filter((l) => l.name !== "0")];
}
