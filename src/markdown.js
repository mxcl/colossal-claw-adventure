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

function renderMarkdown(value) {
  const source = typeof value === "string" ? value.trim() : "";

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
