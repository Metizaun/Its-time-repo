Sim. Você pode criar um degradê animado fazendo o background se deslocar continuamente.

Para a borda do agente principal:

.agent-card {
  position: relative;
  border-radius: 24px;
  background: #fff;
}

.agent-card::before {
  content: "";
  position: absolute;
  inset: -2px;
  z-index: -1;
  border-radius: inherit;

  background: linear-gradient(
    120deg,
    #ff7a1a,
    #ff4d5f,
    #ff2d9a,
    #ff4d5f,
    #ff7a1a
  );

  background-size: 300% 300%;
  animation: gradient-flow 5s ease infinite;
}

@keyframes gradient-flow {
  0% {
    background-position: 0% 50%;
  }

  50% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0% 50%;
  }
}

O efeito será de o laranja, coral e rosa percorrerem a borda, sem alterar o fundo branco do card.

Para um movimento mais sofisticado e menos “vai e volta”, use rotação contínua:

.agent-card {
  position: relative;
  isolation: isolate;
  border-radius: 24px;
  background: #fff;
}

.agent-card::before {
  content: "";
  position: absolute;
  inset: -2px;
  z-index: -1;
  border-radius: inherit;

  background: conic-gradient(
    from 0deg,
    #ff7a1a,
    #ff4d5f,
    #ff2d9a,
    #ff4d5f,
    #ff7a1a
  );

  animation: gradient-spin 5s linear infinite;
}

.agent-card::after {
  content: "";
  position: absolute;
  inset: 2px;
  z-index: -1;
  border-radius: calc(24px - 2px);
  background: #fff;
}

@keyframes gradient-spin {
  to {
    transform: rotate(360deg);
  }
}

Para essa interface, eu usaria a primeira opção. Ela parece mais elegante e tecnológica; a rotação completa pode chamar atenção demais e competir com as ferramentas. Também recomendo uma duração entre 5 e 8 segundos e uma borda de 1,5 a 2 px.