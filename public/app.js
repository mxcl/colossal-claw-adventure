(function () {
  const modal = document.querySelector("[data-bring-your-claw-modal]");
  const closeButtons = document.querySelectorAll("[data-close-bring-your-claw]");
  const copyButton = document.querySelector("[data-copy-gateway-prompt]");
  const promptBlock = document.querySelector("[data-gateway-prompt] code");
  const pageId = document.body.getAttribute("data-page-id");
  const currentPath = window.location.pathname;

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

  if (pageId) {
    window.localStorage.setItem("cca:last-page", currentPath);
    window.localStorage.setItem("cca:last-page-id", pageId);
  }
})();
