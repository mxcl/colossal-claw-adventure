(function () {
  const modal = document.querySelector("[data-bring-your-claw-modal]");
  const activityModal = document.querySelector("[data-claw-activity-modal]");
  const openActivityButtons = document.querySelectorAll("[data-open-claw-activity]");
  const closeActivityButtons = document.querySelectorAll("[data-close-claw-activity]");
  const closeButtons = document.querySelectorAll("[data-close-bring-your-claw]");
  const copyButton = document.querySelector("[data-copy-gateway-prompt]");
  const copyStatus = document.querySelector("[data-copy-prompt-status]");
  const handshakeStatus = document.querySelector("[data-handshake-status]");
  const gatewayStatusPath = modal
    ? modal.getAttribute("data-gateway-status-path") || ""
    : "";
  const gatewayReady = modal
    ? modal.getAttribute("data-gateway-ready") === "1"
    : false;
  let handshakePollTimer = null;
  let modalFocusReturn = null;

  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "textarea:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  function modalReturnPath() {
    return modal ? modal.getAttribute("data-return-path") || "" : "";
  }

  function fallbackCopyText(text) {
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

  async function copyText(text) {
    let clipboardError = null;

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        clipboardError = error;
      }
    }

    try {
      fallbackCopyText(text);
    } catch (fallbackError) {
      throw clipboardError || fallbackError;
    }
  }

  async function fetchPromptText(promptPath) {
    const response = await fetch(promptPath, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("Prompt is no longer available.");
    }

    const body = await response.json();
    return body.prompt || "";
  }

  async function copyPrompt(promptPath) {
    if (!promptPath) {
      throw new Error("Prompt path missing.");
    }

    const promptPromise = fetchPromptText(promptPath);

    if (
      navigator.clipboard &&
      navigator.clipboard.write &&
      window.ClipboardItem &&
      window.isSecureContext
    ) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": promptPromise.then(
              (prompt) => new Blob([prompt], { type: "text/plain" })
            )
          })
        ]);
        return;
      } catch (_error) {
        await copyText(await promptPromise);
        return;
      }
    }

    await copyText(await promptPromise);
  }

  function setCopyStatus(message) {
    if (copyStatus) {
      copyStatus.textContent = message;
    }
  }

  function setHandshakeStatus(message) {
    if (handshakeStatus) {
      handshakeStatus.textContent = message;
    }
  }

  function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(focusableSelector)).filter((element) => {
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none";
    });
  }

  function focusDialog(modalElement) {
    if (!modalElement || modalElement.hidden) {
      return;
    }

    window.requestAnimationFrame(() => {
      const preferred =
        modalElement.querySelector("[data-copy-gateway-prompt]") ||
        modalElement.querySelector("[data-close-bring-your-claw]") ||
        modalElement.querySelector("[data-close-claw-activity]");
      const target = preferred || getFocusableElements(modalElement)[0];

      if (target) {
        target.focus({ preventScroll: true });
      }
    });
  }

  function trapTabKey(event, modalElement) {
    if (event.key !== "Tab" || !modalElement || modalElement.hidden) {
      return;
    }

    const focusableElements = getFocusableElements(modalElement);
    if (!focusableElements.length) {
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openModal() {
    if (modal) {
      modalFocusReturn = document.activeElement;
      modal.hidden = false;
      focusDialog(modal);
    }
  }

  function closeModal() {
    if (handshakePollTimer) {
      window.clearInterval(handshakePollTimer);
      handshakePollTimer = null;
    }

    if (modal) {
      modal.hidden = true;
    }

    if (modalFocusReturn && typeof modalFocusReturn.focus === "function") {
      modalFocusReturn.focus({ preventScroll: true });
      modalFocusReturn = null;
    }

    const url = new URL(modalReturnPath() || window.location.href, window.location.origin);
    if (url.searchParams.has("byoclaw") || url.searchParams.has("issue")) {
      url.searchParams.delete("byoclaw");
      url.searchParams.delete("issue");
    }

    const next =
      url.pathname +
      (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
      url.hash;
    window.history.replaceState({}, "", next);
  }

  function openActivityModal() {
    if (activityModal) {
      activityModal.hidden = false;
      focusDialog(activityModal);
    }
  }

  function closeActivityModal() {
    if (activityModal) {
      activityModal.hidden = true;
    }

    const url = new URL(window.location.href);
    if (url.searchParams.has("clawactivity")) {
      url.searchParams.delete("clawactivity");
      const next =
        url.pathname +
        (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
        url.hash;
      window.history.replaceState({}, "", next);
    }
  }

  function currentPageUrlWithoutModalParams() {
    const url = new URL(modalReturnPath() || window.location.href, window.location.origin);
    url.searchParams.delete("byoclaw");
    url.searchParams.delete("issue");
    return (
      url.pathname +
      (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
      url.hash
    );
  }

  async function pollHandshakeStatus() {
    if (!modal || modal.hidden || !gatewayStatusPath || gatewayReady) {
      return;
    }

    try {
      const response = await fetch(gatewayStatusPath, {
        credentials: "same-origin",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        return;
      }

      const status = await response.json();
      if (!status.ready) {
        return;
      }

      setHandshakeStatus("Handshake complete. Refreshing story state.");
      closeModal();
      window.location.replace(currentPageUrlWithoutModalParams());
    } catch (_error) {
      // Ignore transient polling failures and keep waiting.
    }
  }

  function startHandshakePolling() {
    if (!modal || !gatewayStatusPath || gatewayReady || modal.hidden) {
      return;
    }

    handshakePollTimer = window.setInterval(() => {
      void pollHandshakeStatus();
    }, 2000);
    setHandshakeStatus("Handshake waiting. Checking every 2 seconds.");
  }

  closeButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      closeModal();
    });
  });

  openActivityButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      if (!activityModal) {
        return;
      }

      event.preventDefault();
      openActivityModal();

      const url = new URL(window.location.href);
      url.searchParams.set("clawactivity", "1");
      const next =
        url.pathname +
        (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
        url.hash;
      window.history.replaceState({}, "", next);
    });
  });

  closeActivityButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      closeActivityModal();
    });
  });

  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  if (activityModal) {
    activityModal.addEventListener("click", (event) => {
      if (event.target === activityModal) {
        closeActivityModal();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (activityModal && !activityModal.hidden) {
        closeActivityModal();
        return;
      }

      if (modal && !modal.hidden) {
        closeModal();
      }
      return;
    }

    if (activityModal && !activityModal.hidden) {
      trapTabKey(event, activityModal);
      return;
    }

    if (modal && !modal.hidden) {
      trapTabKey(event, modal);
    }
  });

  if (document.body.getAttribute("data-modal-open") === "1") {
    openModal();
    startHandshakePolling();
  }

  if (document.body.getAttribute("data-activity-modal-open") === "1") {
    openActivityModal();
  }

  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      const originalLabel = copyButton.textContent;
      const promptPath = copyButton.getAttribute("data-copy-gateway-prompt");

      try {
        copyButton.disabled = true;
        copyButton.setAttribute("aria-busy", "true");
        copyButton.textContent = "Copying...";
        setCopyStatus("Preparing prompt for clipboard.");
        await copyPrompt(promptPath);
        copyButton.textContent = "Copied Prompt";
        setCopyStatus("Prompt copied. Paste it into your agent to continue.");
      } catch (_error) {
        copyButton.textContent = "Copy Failed";
        setCopyStatus("Copy failed. Issue a fresh prompt or try again.");
      } finally {
        copyButton.disabled = false;
        copyButton.removeAttribute("aria-busy");
      }

      window.setTimeout(() => {
        copyButton.textContent = originalLabel;
        setCopyStatus("Ready to copy.");
      }, 1500);
    });
  }
})();
