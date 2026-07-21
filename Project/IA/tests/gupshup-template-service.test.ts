import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import {
  GupshupTemplateApiError,
  GupshupTemplateService,
  validateCreateGupshupTemplateInput,
} from "../gupshup-template-service.js";

test("aceita um template Gupshup valido com exemplo", () => {
  assert.equal(
    validateCreateGupshupTemplateInput({
      elementName: "retomar_atendimento",
      content: "Ola {{1}}, podemos continuar seu atendimento?",
      category: "UTILITY",
      example: "Maria",
    }),
    null,
  );
});

test("rejeita nome invalido e exemplo ausente antes de chamar a Gupshup", () => {
  assert.match(
    validateCreateGupshupTemplateInput({
      elementName: "Retomar Atendimento",
      content: "Ola {{1}}",
      example: "Maria",
    }) ?? "",
    /minusculas/,
  );

  assert.match(
    validateCreateGupshupTemplateInput({
      elementName: "retomar_atendimento",
      content: "Ola {{1}}",
    }) ?? "",
    /example/,
  );
});

test("rejeita variaveis numericas fora de sequencia", () => {
  assert.match(
    validateCreateGupshupTemplateInput({
      elementName: "retomar_atendimento",
      content: "Ola {{2}}",
      example: "Maria",
    }) ?? "",
    /sequenciais/,
  );
});

test("aceita os quatro formatos e valida idioma e exemplos por variavel", () => {
  for (const templateType of ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const) {
    assert.equal(
      validateCreateGupshupTemplateInput({
        elementName: `template_${templateType.toLowerCase()}`,
        content: "Ola {{1}}, seu codigo e {{2}}",
        languageCode: "pt_BR",
        category: "MARKETING",
        templateType,
        example: "Maria, 1234",
      }),
      null,
    );
  }

  assert.match(
    validateCreateGupshupTemplateInput({
      elementName: "idioma_invalido",
      content: "Ola",
      languageCode: "portugues",
      example: "Mensagem de exemplo",
    }) ?? "",
    /languageCode/,
  );
  assert.match(
    validateCreateGupshupTemplateInput({
      elementName: "exemplo_incompleto",
      content: "Ola {{1}}, codigo {{2}}",
      example: "Maria",
    }) ?? "",
    /2 valor/,
  );
});

test("traduz a limitacao de criacao da plataforma Gupshup", async () => {
  const originalPost = axios.post;
  axios.post = (async () => {
    const error = new Error("Request failed") as Error & {
      isAxiosError: boolean;
      response: { status: number; data: { message: string } };
    };
    error.isAxiosError = true;
    error.response = {
      status: 400,
      data: { message: "Template Not Supported On Gupshup Platform" },
    };
    throw error;
  }) as typeof axios.post;

  try {
    const service = new GupshupTemplateService({
      apiKey: "test-key",
      appId: "test-app",
    });
    await assert.rejects(
      service.createTemplate({
        elementName: "retomar_atendimento",
        content: "Ola {{1}}",
        example: "Maria",
      }),
      (error: unknown) =>
        error instanceof GupshupTemplateApiError &&
        error.upstreamStatus === 400 &&
        /nao permite criar templates via API/.test(error.message),
    );
  } finally {
    axios.post = originalPost;
  }
});
