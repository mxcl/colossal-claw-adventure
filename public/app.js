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

  if (copyButton && promptBlock && navigator.clipboard) {
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(promptBlock.textContent || "");
      copyButton.textContent = "Copied Prompt";
      window.setTimeout(() => {
        copyButton.textContent = "Copy Prompt";
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
