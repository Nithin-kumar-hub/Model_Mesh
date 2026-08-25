package com.modelmesh.ui.input

/**
 * Content handed to a fresh task from an Android share (`ACTION_SEND`).
 *
 * The split here is the whole point, and it is Rule 6 at the system boundary:
 *  - [text] is shared *as an instruction* and may prefill the instruction field;
 *  - [streamUri] (a shared image or PDF) is *material*, and is only ever routed
 *    through `onAttachmentPicked` so it goes through on-device preprocessing and is
 *    kept separate from the instruction. It is never concatenated into [text].
 *
 * A given share is one or the other in practice, but both are modelled so a receiver
 * never has to guess.
 */
data class SharedContent(
    val text: String? = null,
    val streamUri: String? = null,
    val mimeType: String? = null,
    val displayName: String? = null,
) {
    val isEmpty: Boolean get() = text.isNullOrBlank() && streamUri.isNullOrBlank()
}
