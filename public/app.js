(function () {
  const modal = document.querySelector("[data-bring-your-claw-modal]");
  const activityModal = document.querySelector("[data-claw-activity-modal]");
  const openActivityButtons = document.querySelectorAll("[data-open-claw-activity]");
  const closeActivityButtons = document.querySelectorAll("[data-close-claw-activity]");
  const closeButtons = document.querySelectorAll("[data-close-bring-your-claw]");
  const copyButton = document.querySelector("[data-copy-gateway-prompt]");
  const gatewayStatusPath = modal
    ? modal.getAttribute("data-gateway-status-path") || ""
    : "";
  const gatewayReady = modal
    ? modal.getAttribute("data-gateway-ready") === "1"
    : false;
  let handshakePollTimer = null;

  function modalReturnPath() {
    return modal ? modal.getAttribute("data-return-path") || "" : "";
  }

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

  function openModal() {
    if (modal) {
      modal.hidden = false;
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
        if (!promptPath) {
          throw new Error("Prompt path missing.");
        }

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
        await copyText(body.prompt || "");
        copyButton.textContent = "Copied Prompt";
      } catch (_error) {
        copyButton.textContent = "Copy Failed";
      }

      window.setTimeout(() => {
        copyButton.textContent = originalLabel;
      }, 1500);
    });
  }
})();
