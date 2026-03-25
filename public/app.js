(function () {
  const modal = document.querySelector("[data-bring-your-claw-modal]");
  const closeButtons = document.querySelectorAll("[data-close-bring-your-claw]");
  const copyButton = document.querySelector("[data-copy-gateway-prompt]");
  const promptBlock = document.querySelector("[data-gateway-prompt] code");
  const gatewayStatusPath = modal
    ? modal.getAttribute("data-gateway-status-path") || ""
    : "";
  const gatewayReady = modal
    ? modal.getAttribute("data-gateway-ready") === "1"
    : false;
  let handshakePollTimer = null;

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

  function currentPageUrlWithoutModalParams() {
    const url = new URL(window.location.href);
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

  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  if (document.body.getAttribute("data-modal-open") === "1") {
    openModal();
    startHandshakePolling();
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
})();
