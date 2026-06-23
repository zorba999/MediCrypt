// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MediCrypt — Private on-chain AI symptom triage on Ritual Chain
/// @notice Sends a user's symptoms to the Ritual LLM precompile (0x0802), which runs
///         inference inside a TEE. When the caller supplies an ephemeral ECIES public
///         key, the executor encrypts the triage result so ONLY the caller can read it.
///         No symptom text or triage answer is ever written to contract storage — the
///         encrypted result is emitted once, in an event, for the caller to decrypt
///         client-side. The chain only keeps anonymous usage counters.
contract MediCrypt {
    // ------------------------------------------------------------------ //
    // Ritual system addresses (fixed across all Ritual Chain deployments) //
    // ------------------------------------------------------------------ //
    address internal constant LLM_PRECOMPILE =
        0x0000000000000000000000000000000000000802;
    IRitualWallet internal constant RITUAL_WALLET =
        IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    /// @dev Pinned production model for Ritual LLM inference.
    string internal constant MODEL = "zai-org/GLM-4.7-FP8";

    /// @dev Triage system prompt. Must contain NO double quotes or newlines so it can be
    ///      concatenated into a JSON string value safely.
    string internal constant SYSTEM_PROMPT =
        "You are MediCrypt, a careful medical triage assistant. The user describes "
        "symptoms. Reply with ONLY a JSON object (no markdown) with keys: risk_level "
        "(one of low, medium, high, emergency), summary (a short plain-language "
        "explanation), advice (an array of short action strings), see_doctor (boolean), "
        "and disclaimer (a string). Never give a definitive diagnosis. Always state that "
        "this is informational and not a substitute for professional medical care. If the "
        "symptoms suggest an emergency such as chest pain, trouble breathing, signs of "
        "stroke, or severe bleeding, set risk_level to emergency and advise contacting "
        "local emergency services immediately.";

    /// @notice StorageRef tuple expected as the LLM precompile's convoHistory field.
    struct StorageRef {
        string platform;
        string path;
        string keyRef;
    }

    // --------------------------- usage stats --------------------------- //
    uint256 public totalTriages;
    mapping(address => uint256) public triageCount;
    mapping(address => uint256) public lastTriageBlock;

    event TriageRequested(address indexed user, uint256 indexed index);
    /// @param encryptedResult ECIES ciphertext (when a userPublicKey was supplied) or the
    ///        raw ABI-encoded completion payload (when it was empty). Decode/decrypt off-chain.
    event TriageCompleted(
        address indexed user,
        uint256 indexed index,
        bool hasError,
        bytes encryptedResult
    );

    /// @notice Top up the shared RitualWallet escrow that funds async inference fees.
    function depositForFees() external payable {
        RITUAL_WALLET.deposit{value: msg.value}(5000);
    }

    function ritualBalance(address user) external view returns (uint256) {
        return RITUAL_WALLET.balanceOf(user);
    }

    /// @notice Request a private triage for the given symptoms.
    /// @param executor       A registered LLM-capable TEE executor address.
    /// @param symptoms       Free-text symptom description (escaped into the prompt on-chain).
    /// @param userPublicKey  Ephemeral ECIES public key. If non-empty, the executor encrypts
    ///                       the result to it so only the caller can decrypt. Pass 0x to skip.
    function requestTriage(
        address executor,
        string calldata symptoms,
        bytes calldata userPublicKey
    ) external {
        uint256 index = triageCount[msg.sender];
        emit TriageRequested(msg.sender, index);

        bytes memory input = _encodeRequest(executor, symptoms, userPublicKey);

        // Short-running async: the builder re-executes this tx with the settled output
        // injected, so the precompile call returns (bytes simmedInput, bytes actualOutput).
        (bool success, bytes memory result) = LLM_PRECOMPILE.call(input);
        require(success, "LLM precompile call failed");
        (, bytes memory actualOutput) = abi.decode(result, (bytes, bytes));

        (bool hasError, bytes memory completionData, , , ) = abi.decode(
            actualOutput,
            (bool, bytes, bytes, string, StorageRef)
        );

        triageCount[msg.sender] = index + 1;
        totalTriages += 1;
        lastTriageBlock[msg.sender] = block.number;

        emit TriageCompleted(msg.sender, index, hasError, completionData);
    }

    /// @dev Builds the 30-field LLM precompile request tuple.
    function _encodeRequest(
        address executor,
        string calldata symptoms,
        bytes calldata userPublicKey
    ) internal pure returns (bytes memory) {
        string memory messagesJson = string(
            abi.encodePacked(
                '[{"role":"system","content":"',
                SYSTEM_PROMPT,
                '"},{"role":"user","content":"',
                _jsonEscape(symptoms),
                '"}]'
            )
        );

        return
            abi.encode(
                executor, // executor
                new bytes[](0), // encryptedSecrets
                uint256(300), // ttl
                new bytes[](0), // secretSignatures
                userPublicKey, // userPublicKey -> output encrypted to caller
                messagesJson, // messagesJson
                MODEL, // model
                int256(0), // frequencyPenalty
                "", // logitBiasJson
                false, // logprobs
                int256(4096), // maxCompletionTokens
                "", // metadataJson
                "", // modalitiesJson
                uint256(1), // n
                true, // parallelToolCalls
                int256(0), // presencePenalty
                "medium", // reasoningEffort
                bytes(""), // responseFormatData
                int256(-1), // seed
                "auto", // serviceTier
                "", // stopJson
                false, // stream
                int256(300), // temperature (0.3 x1000)
                bytes(""), // toolChoiceData
                bytes(""), // toolsData
                int256(-1), // topLogprobs
                int256(1000), // topP
                "", // user
                false, // piiEnabled
                StorageRef("", "", "") // convoHistory (stateless)
            );
    }

    /// @dev Minimal JSON string escaper: escapes backslash and double-quote, and replaces
    ///      control characters (< 0x20) with spaces so the prompt stays valid JSON.
    function _jsonEscape(string calldata s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length * 2);
        uint256 j = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == '"' || c == "\\") {
                out[j++] = "\\";
                out[j++] = c;
            } else if (uint8(c) < 0x20) {
                out[j++] = " ";
            } else {
                out[j++] = c;
            }
        }
        assembly {
            mstore(out, j)
        }
        return string(out);
    }
}

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function balanceOf(address user) external view returns (uint256);
}
