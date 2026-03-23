const { marked } = require("marked");
const sanitizeHtml = require("sanitize-html");

const allowedTags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul"
];

const allowedAttributes = {
  a: ["href", "rel", "target", "title"]
};

marked.use({
  gfm: true
});

function normalizeHeadingText(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripMatchingLeadingHeading(source, headingText) {
  if (!source || !headingText) {
    return source;
  }

  const [firstToken] = marked.lexer(source);
  if (!firstToken || firstToken.type !== "heading") {
    return source;
  }

  if (normalizeHeadingText(firstToken.text) !== normalizeHeadingText(headingText)) {
    return source;
  }

  return source.slice(firstToken.raw.length).trimStart();
}

function renderMarkdown(value, options = {}) {
  let source = typeof value === "string" ? value.trim() : "";

  source = stripMatchingLeadingHeading(source, options.stripHeadingText);

  if (!source) {
    return "";
  }

  return sanitizeHtml(marked.parse(source), {
    allowedAttributes,
    allowedSchemes: ["http", "https", "mailto"],
    allowedTags,
    transformTags: {
      a(tagName, attribs) {
        return {
          attribs: {
            ...attribs,
            rel: "noreferrer noopener",
            target: "_blank"
          },
          tagName
        };
      }
    }
  });
}

module.exports = {
  renderMarkdown
};
