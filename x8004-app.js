/**
 * bn8004 LaunchPad - ERC-8004 代币发行平台
 * 由 ERC-2771 元交易协议驱动
 */

(function () {
  // 配置
  const CONFIG = {
    USDC_ADDRESS: "0x55d398326f99059fF775485246999027B3197955", // BSC上的USDT
    TOKEN_ADDRESS: "0xAbd0c33d4A624E695BB41Ab003021CB30Be80e37", // 新的BSC合约地址
    FORWARDER_ADDRESS: "0x21DdAd2f176cf2fFFEd0510069D6f1fCe93C9642",
    RELAYER_URL:
      window.location.hostname === "localhost"
        ? "http://localhost:3000/api/relay"
        : "/api/relay",
    CHAIN_ID: 56, // BSC 主网
    RPC_URL:
      "https://bsc-dataseed.binance.org/",
    MINT_RATIO: 8004,
  };

  let provider, signer, userAddress;
  let usdcContract, tokenContract, forwarderContract;
  let isApproved = false;

  // DOM 元素
  const elements = {
    connectButton: document.getElementById("connectButton"),
    approveBtn: document.getElementById("approveBtn"),
    mintBtn: document.getElementById("mintBtn"),
    approveText: document.getElementById("approveText"),
    mintText: document.getElementById("mintText"),
    walletAddress: document.getElementById("walletAddress"),
    usdtBalance: document.getElementById("usdtBalance"),
    tokenBalance: document.getElementById("tokenBalance"),
    mintSection: document.getElementById("mintSection"),
    message: document.getElementById("message"),
  };

  // 工具函数
  function showMessage(text, type) {
    if (elements.message) {
      elements.message.innerHTML = text;
      elements.message.className = type;
      elements.message.classList.add("show");

      if (type === "success" || type === "info") {
        setTimeout(() => {
          elements.message.style.display = "none";
        }, 5000);
      }
    }
  }

  function showLoading(btnId, text) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="loading"></span>${text}`;
    }
  }

  function hideLoading(btnId, text) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = text;
    }
  }

  function shortAddress(addr) {
    return addr ? addr.slice(0, 6) + "..." + addr.slice(-4) : "未连接";
  }

  // 连接钱包
  async function connectWallet() {
    try {
      if (typeof window.ethereum === "undefined") {
        showMessage("请安装MetaMask钱包", "error");
        return;
      }

      showLoading("connectButton", "连接中...");

      // 请求账户
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      // 检查网络
      const chainId = await window.ethereum.request({
        method: "eth_chainId",
      });

      if (parseInt(chainId, 16) !== CONFIG.CHAIN_ID) {
        showMessage("请切换到BSC主网", "error");
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x38" }], // BSC 主网 (56)
          });
        } catch (switchError) {
          // 如果网络不存在，则添加
          if (switchError.code === 4902) {
            try {
              await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [
                  {
                    chainId: "0x38",
                    chainName: "Binance Smart Chain",
                    nativeCurrency: {
                      name: "Binance Coin",
                      symbol: "BNB",
                      decimals: 18,
                    },
                    rpcUrls: [CONFIG.RPC_URL],
                    blockExplorerUrls: ["https://bscscan.com"],
                  },
                ],
              });
            } catch (addError) {
              hideLoading("connectButton", "连接钱包");
              showMessage("添加BSC网络失败", "error");
              return;
            }
          } else {
            hideLoading("connectButton", "连接钱包");
            return;
          }
        }
      }

      // 初始化 ethers
      provider = new ethers.providers.Web3Provider(window.ethereum);
      signer = provider.getSigner();
      userAddress = accounts[0];

      // 初始化合约
      usdcContract = new ethers.Contract(
        CONFIG.USDC_ADDRESS,
        [
          "function balanceOf(address) view returns (uint256)",
          "function approve(address,uint256) returns (bool)",
          "function allowance(address,address) view returns (uint256)",
        ],
        signer
      );

      tokenContract = new ethers.Contract(
        CONFIG.TOKEN_ADDRESS,
        [
          "function balanceOf(address) view returns (uint256)",
          "function name() view returns (string)",
          "function symbol() view returns (string)",
        ],
        provider
      );

      forwarderContract = new ethers.Contract(
        CONFIG.FORWARDER_ADDRESS,
        ["function getNonce(address) view returns (uint256)"],
        provider
      );

      // 更新UI
      if (elements.walletAddress) {
        elements.walletAddress.textContent = shortAddress(userAddress);
      }
      if (elements.connectButton) {
        elements.connectButton.innerHTML = `<span class="btn-text">${shortAddress(
          userAddress
        )}</span>`;
      }
      if (elements.mintSection) {
        elements.mintSection.style.display = "block";
      }

      // 加载余额
      await loadBalances();

      // 检查授权状态
      await checkApproval();

      showMessage("钱包连接成功！", "success");
    } catch (error) {
      console.error(error);
      showMessage("连接失败: " + error.message, "error");
      hideLoading("connectButton", "连接钱包");
    }
  }

  // 加载余额
  async function loadBalances() {
    try {
      const usdtBalance = await usdcContract.balanceOf(userAddress);
      const tokenBalance = await tokenContract.balanceOf(userAddress);

      if (elements.usdtBalance) {
        elements.usdtBalance.textContent =
          parseFloat(ethers.utils.formatUnits(usdtBalance, 18)).toFixed(2) +
          " USDT";
      }

      if (elements.tokenBalance) {
        elements.tokenBalance.textContent =
          parseFloat(ethers.utils.formatEther(tokenBalance)).toLocaleString() +
          " BN8004";
      }
    } catch (error) {
      console.error("加载余额失败:", error);
    }
  }

  // 检查授权
  async function checkApproval() {
    try {
      const allowance = await usdcContract.allowance(
        userAddress,
        CONFIG.TOKEN_ADDRESS
      );
      const requiredAmount = ethers.utils.parseUnits("1", 18); // USDT在BSC上有18位小数

      if (allowance.gte(requiredAmount)) {
        isApproved = true;
        if (elements.approveBtn) elements.approveBtn.disabled = true;
        if (elements.approveText)
          elements.approveText.textContent = "✓ 已授权";
        if (elements.mintBtn) elements.mintBtn.disabled = false;
      } else {
        isApproved = false;
        if (elements.approveBtn) elements.approveBtn.disabled = false;
        if (elements.approveText)
          elements.approveText.textContent = "步骤1: 授权USDT";
        if (elements.mintBtn) elements.mintBtn.disabled = true;
      }
    } catch (error) {
      console.error("检查授权失败:", error);
    }
  }

  // 授权USDT
  window.approveUSDC = async function () {
    try {
      showLoading("approveBtn", "授权中...");
      showMessage("请在钱包中确认授权...", "info");

      // 授权10个USDT用于多次铸造 (USDT在BSC上有18位小数)
      const approveAmount = ethers.utils.parseUnits("10", 18);
      const tx = await usdcContract.approve(
        CONFIG.TOKEN_ADDRESS,
        approveAmount
      );

      showMessage(
        "授权交易已提交，等待确认...",
        "info"
      );
      await tx.wait();

      isApproved = true;
      if (elements.approveBtn) elements.approveBtn.disabled = true;
      if (elements.approveText) elements.approveText.textContent = "✓ 已授权";
      if (elements.mintBtn) elements.mintBtn.disabled = false;

      showMessage(
        "USDT授权成功！(10 USDT = 10次铸造)",
        "success"
      );
    } catch (error) {
      console.error(error);
      if (error.code === 4001) {
        showMessage("用户取消了授权", "error");
      } else {
        showMessage("授权失败: " + error.message, "error");
      }
      hideLoading("approveBtn", "步骤1: 授权USDT");
    }
  };

  // 铸造代币
  window.mintTokens = async function () {
    try {
      console.log("🚀 开始铸造过程...");

      if (!isApproved) {
        showMessage("请先授权USDT", "error");
        return;
      }

      showLoading("mintBtn", "铸造中...");
      showMessage("准备X402元交易...", "info");

      console.log("📝 配置:", {
        TOKEN_ADDRESS: CONFIG.TOKEN_ADDRESS,
        FORWARDER_ADDRESS: CONFIG.FORWARDER_ADDRESS,
        RELAYER_URL: CONFIG.RELAYER_URL,
      });

      // 准备铸造调用数据
      const tokenInterface = new ethers.utils.Interface(["function mint()"]);
      const mintData = tokenInterface.encodeFunctionData("mint", []);

      // 获取nonce
      console.log("🔢 获取nonce...");
      const nonce = await forwarderContract.getNonce(userAddress);
      console.log("✓ Nonce:", nonce.toString());

      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const forwardRequest = {
        from: userAddress,
        to: CONFIG.TOKEN_ADDRESS,
        value: 0,
        gas: 300000,
        nonce: nonce.toNumber(),
        deadline: deadline,
        data: mintData,
      };

      console.log("📄 转发请求:", forwardRequest);

      // EIP-712签名
      const domain = {
        name: "MinimalForwarder",
        version: "1.0.0",
        chainId: CONFIG.CHAIN_ID,
        verifyingContract: CONFIG.FORWARDER_ADDRESS,
      };

      const types = {
        ForwardRequest: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "gas", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      };

      showMessage("请在钱包中签名...", "info");
      console.log("✍️ 请求签名...");
      const signature = await signer._signTypedData(
        domain,
        types,
        forwardRequest
      );
      console.log("✓ 签名获取成功:", signature.slice(0, 20) + "...");

      // 发送到中继器
      showMessage("发送到X402中继器...", "info");
      console.log("📤 发送到中继器:", CONFIG.RELAYER_URL);

      const response = await fetch(CONFIG.RELAYER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          forwardRequest,
          signature,
        }),
      });

      console.log("📥 响应状态:", response.status);
      const result = await response.json();
      console.log("📦 响应结果:", result);

      if (result.success) {
        const txLink = `https://bscscan.com/tx/${result.txHash}`;
        showMessage(
          `<strong>铸造成功!</strong><br>
                    +8004 BN8004 代币<br>
                    <a href="${txLink}" target="_blank" style="color: var(--primary); text-decoration: underline;">查看交易</a>`,
          "success"
        );

        // 几秒钟后刷新余额
        setTimeout(async () => {
          await loadBalances();
          await checkApproval();
        }, 3000);
      } else {
        showMessage("铸造失败: " + result.error, "error");
      }

      hideLoading("mintBtn", "步骤2: 铸造");
    } catch (error) {
      console.error("❌ 铸造错误:", error);
      console.error("错误详情:", {
        message: error.message,
        code: error.code,
        stack: error.stack,
      });

      if (error.code === 4001) {
        showMessage("用户取消了签名", "error");
      } else if (error.message) {
        showMessage("铸造失败: " + error.message, "error");
      } else {
        showMessage(
          "铸造失败。请检查控制台 (F12) 获取详情。",
          "error"
        );
      }
      hideLoading("mintBtn", "步骤2: 铸造");
    }
  };

  // 事件监听器
  document.addEventListener("DOMContentLoaded", () => {
    if (elements.connectButton) {
      elements.connectButton.addEventListener("click", connectWallet);
    }

    // 监听账户变化
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        location.reload();
      });

      window.ethereum.on("chainChanged", () => {
        location.reload();
      });
    }
  });
})();