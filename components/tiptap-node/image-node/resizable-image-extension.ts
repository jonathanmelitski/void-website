import { Image } from "@tiptap/extension-image"
import { mergeAttributes } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { ResizableImageView } from "./resizable-image"

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute("width") || null,
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
      align: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-align") || "left",
        renderHTML: (attrs) => ({ "data-align": attrs.align }),
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
