(function () {
  const modal = document.querySelector("[data-bring-your-claw-modal]");
  const closeButtons = document.querySelectorAll("[data-close-bring-your-claw]");
  const copyButton = document.querySelector("[data-copy-gateway-prompt]");
  const promptBlock = document.querySelector("[data-gateway-prompt] code");
  const pageId = document.body.getAttribute("data-page-id");
  const currentPath = window.location.pathname;
  const landingActions = document.querySelector("[data-landing-actions]");
  const beginLink = document.querySelector("[data-landing-begin]");
  const continueLink = document.querySelector("[data-landing-continue]");
  const restartLink = document.querySelector("[data-landing-restart]");

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.top = "0";
    fallback.style.left = "0";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();

    const copied = document.execCommand("copy");
    document.body.removeChild(fallback);

    if (!copied) {
      throw new Error("Copy command was rejected.");
    }
  }

  function getSavedStoryPath() {
    const saved = window.localStorage.getItem("cca:last-page");

    return saved && saved.startsWith("/page/") ? saved : "";
  }

  function clearSavedStoryPath() {
    window.localStorage.removeItem("cca:last-page");
    window.localStorage.removeItem("cca:last-page-id");
  }

  function syncLandingActions() {
    if (!landingActions) {
      return;
    }

    const rootPath = landingActions.getAttribute("data-root-path") || "/";
    const viewerPresent = landingActions.getAttribute("data-viewer-present") === "1";
    const savedPath = getSavedStoryPath();
    const shouldShowResumeActions = viewerPresent || Boolean(savedPath);

    document.documentElement.toggleAttribute(
      "data-has-saved-story",
      Boolean(savedPath)
    );

    if (continueLink) {
      continueLink.href = savedPath || rootPath;
    }

    if (beginLink) {
      beginLink.setAttribute(
        "aria-hidden",
        shouldShowResumeActions ? "true" : "false"
      );
    }

    if (continueLink) {
      continueLink.setAttribute(
        "aria-hidden",
        shouldShowResumeActions ? "false" : "true"
      );
    }

    if (restartLink) {
      restartLink.setAttribute(
        "aria-hidden",
        shouldShowResumeActions ? "false" : "true"
      );
    }
  }

  function openModal() {
    if (modal) {
      modal.hidden = false;
    }
  }

  function closeModal() {
    if (modal) {
      modal.hidden = true;
    }

    const url = new URL(window.location.href);
    if (url.searchParams.has("byoclaw") || url.searchParams.has("issue")) {
      url.searchParams.delete("byoclaw");
      url.searchParams.delete("issue");
      const next =
        url.pathname +
        (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
        url.hash;
      window.history.replaceState({}, "", next);
    }
  }

  closeButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      closeModal();
    });
  });

  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  if (document.body.getAttribute("data-modal-open") === "1") {
    openModal();
  }

  if (copyButton && promptBlock) {
    copyButton.addEventListener("click", async () => {
      const originalLabel = copyButton.textContent;

      try {
        await copyText(promptBlock.textContent || "");
        copyButton.textContent = "Copied Prompt";
      } catch (_error) {
        copyButton.textContent = "Copy Failed";
      }

      window.setTimeout(() => {
        copyButton.textContent = originalLabel;
      }, 1500);
    });
  }

  if (restartLink) {
    restartLink.addEventListener("click", () => {
      clearSavedStoryPath();
    });
  }

  if (pageId) {
    window.localStorage.setItem("cca:last-page", currentPath);
    window.localStorage.setItem("cca:last-page-id", pageId);
  }

  syncLandingActions();
})();
