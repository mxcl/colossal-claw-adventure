(function () {
  const modal = document.querySelector("[data-bring-your-claw-modal]");
  const closeButtons = document.querySelectorAll("[data-close-bring-your-claw]");
  const copyButton = document.querySelector("[data-copy-gateway-prompt]");
  const promptBlock = document.querySelector("[data-gateway-prompt] code");
  const pageId = document.body.getAttribute("data-page-id");
  const resumeBanner = document.querySelector("[data-resume-banner]");
  const resumeLink = document.querySelector("[data-resume-link]");
  const currentPath = window.location.pathname;
  const storedPath = window.localStorage.getItem("cca:last-page");

  function openModal() {
    if (modal) {
      modal.hidden = false;
    }
  }

  function closeModal() {
    if (modal) {
      modal.hidden = true;
    }
  }

  closeButtons.forEach((button) => {
    button.addEventListener("click", closeModal);
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
    if (storedPath && storedPath !== currentPath && resumeBanner && resumeLink) {
      resumeBanner.hidden = false;
      resumeLink.href = storedPath;
    }

    window.localStorage.setItem("cca:last-page", currentPath);
    window.localStorage.setItem("cca:last-page-id", pageId);
  }
})();
