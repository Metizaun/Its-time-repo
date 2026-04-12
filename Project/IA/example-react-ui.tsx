// ============================================================
// Exemplo de Interface React - Gerenciamento de Agentes
// Copie este código para integrar no seu frontend
// ============================================================

import React, { useState, useEffect } from 'react'

// ─── Tipos ────────────────────────────────────────────────────

interface Agent {
  agentId: string
  agentName: string
  instanceName: string
  isActive: boolean
  createdAt: string
}

interface AgentDetail extends Agent {
  systemMessage: string
  userMessageTemplate: string
  bufferWaitMs: number
  acesId: number
}

// ─── Configuração ─────────────────────────────────────────────

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000'
const AUTH_TOKEN = localStorage.getItem('authToken') || 'user_123' // Implemente autenticação real

// ─── Componente Principal ─────────────────────────────────────

export default function AgentManagement() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchAgents()
  }, [])

  // ═══════════════════════════════════════════════════════════
  // API Calls
  // ═══════════════════════════════════════════════════════════

  const fetchAgents = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/agents`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      })
      const data = await response.json()
      setAgents(data.agents || [])
    } catch (error) {
      console.error('Erro ao carregar agentes:', error)
      alert('Erro ao carregar agentes')
    } finally {
      setLoading(false)
    }
  }

  const fetchAgentDetails = async (agentId: string) => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/agents/${agentId}`, {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      })
      const data = await response.json()
      setSelectedAgent(data.agent)
    } catch (error) {
      console.error('Erro ao carregar detalhes:', error)
      alert('Erro ao carregar detalhes do agente')
    } finally {
      setLoading(false)
    }
  }

  const toggleAgent = async (agentId: string, isActive: boolean) => {
    const action = isActive ? 'pause' : 'activate'
    try {
      await fetch(`${API_BASE_URL}/api/agents/${agentId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      })
      fetchAgents()
      if (selectedAgent?.agentId === agentId) {
        setSelectedAgent({ ...selectedAgent, isActive: !isActive })
      }
    } catch (error) {
      console.error('Erro ao alternar status:', error)
      alert('Erro ao alternar status do agente')
    }
  }

  const duplicateAgent = async (agentId: string) => {
    const newName = prompt('Nome do novo agente:')
    const newInstance = prompt('Nome da nova instância Evolution:')

    if (!newName || !newInstance) return

    try {
      await fetch(`${API_BASE_URL}/api/agents/${agentId}/duplicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({ newName, newInstanceName: newInstance }),
      })
      alert('Agente duplicado com sucesso!')
      fetchAgents()
    } catch (error) {
      console.error('Erro ao duplicar:', error)
      alert('Erro ao duplicar agente')
    }
  }

  const deleteAgent = async (agentId: string) => {
    if (!confirm('Tem certeza que deseja deletar este agente?')) return

    try {
      await fetch(`${API_BASE_URL}/api/agents/${agentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      })
      alert('Agente deletado com sucesso!')
      fetchAgents()
      setSelectedAgent(null)
    } catch (error) {
      console.error('Erro ao deletar:', error)
      alert('Erro ao deletar agente')
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui' }}>
      {/* Sidebar - Lista de Agentes */}
      <div style={{ width: '300px', borderRight: '1px solid #ddd', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>Agentes</h2>
          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              padding: '8px 16px',
              background: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            + Novo
          </button>
        </div>

        {loading && <p>Carregando...</p>}

        {agents.length === 0 && !loading && (
          <p style={{ color: '#666' }}>Nenhum agente criado ainda.</p>
        )}

        {agents.map((agent) => (
          <div
            key={agent.agentId}
            onClick={() => fetchAgentDetails(agent.agentId)}
            style={{
              padding: '12px',
              marginBottom: '8px',
              background: selectedAgent?.agentId === agent.agentId ? '#e3f2fd' : '#f5f5f5',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{agent.agentName}</strong>
              <span style={{ fontSize: '20px' }}>{agent.isActive ? '🟢' : '🔴'}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              {agent.instanceName}
            </div>
          </div>
        ))}
      </div>

      {/* Main Content - Detalhes ou Formulário */}
      <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
        {showCreateForm ? (
          <CreateAgentForm
            onClose={() => setShowCreateForm(false)}
            onSuccess={() => {
              setShowCreateForm(false)
              fetchAgents()
            }}
          />
        ) : selectedAgent ? (
          <AgentDetails
            agent={selectedAgent}
            onToggle={() => toggleAgent(selectedAgent.agentId, selectedAgent.isActive)}
            onDuplicate={() => duplicateAgent(selectedAgent.agentId)}
            onDelete={() => deleteAgent(selectedAgent.agentId)}
            onUpdate={(updated) => setSelectedAgent(updated)}
          />
        ) : (
          <div style={{ textAlign: 'center', marginTop: '100px', color: '#999' }}>
            <h3>Selecione um agente ou crie um novo</h3>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Formulário de Criação ───────────────────────────────────

function CreateAgentForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    agentName: '',
    instanceName: '',
    acesId: 1,
    systemMessage: DEFAULT_SYSTEM_MESSAGE,
    userMessageTemplate: DEFAULT_USER_MESSAGE_TEMPLATE,
    bufferWaitMs: 15000,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const response = await fetch(`${API_BASE_URL}/api/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        alert('Agente criado com sucesso!')
        onSuccess()
      } else {
        throw new Error('Erro ao criar agente')
      }
    } catch (error) {
      console.error('Erro ao criar:', error)
      alert('Erro ao criar agente')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>Criar Novo Agente</h2>
        <button onClick={onClose} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          ✕ Fechar
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
            Nome do Agente
          </label>
          <input
            type="text"
            required
            value={formData.agentName}
            onChange={(e) => setFormData({ ...formData, agentName: e.target.value })}
            placeholder="Ex: Bento - Ótica Central"
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
            Nome da Instância Evolution
          </label>
          <input
            type="text"
            required
            value={formData.instanceName}
            onChange={(e) => setFormData({ ...formData, instanceName: e.target.value })}
            placeholder="Ex: instance_otica_001"
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
            Prompt do Sistema
          </label>
          <textarea
            required
            value={formData.systemMessage}
            onChange={(e) => setFormData({ ...formData, systemMessage: e.target.value })}
            rows={10}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontFamily: 'monospace',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
            Template de Mensagem
          </label>
          <textarea
            required
            value={formData.userMessageTemplate}
            onChange={(e) => setFormData({ ...formData, userMessageTemplate: e.target.value })}
            rows={6}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontFamily: 'monospace',
            }}
          />
        </div>

        <button
          type="submit"
          style={{
            padding: '12px',
            background: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          Criar Agente
        </button>
      </form>
    </div>
  )
}

// ─── Detalhes do Agente ───────────────────────────────────────

function AgentDetails({
  agent,
  onToggle,
  onDuplicate,
  onDelete,
  onUpdate,
}: {
  agent: AgentDetail
  onToggle: () => void
  onDuplicate: () => void
  onDelete: () => void
  onUpdate: (agent: AgentDetail) => void
}) {
  const [editing, setEditing] = useState(false)
  const [formData, setFormData] = useState({ ...agent })

  const handleUpdate = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/agents/${agent.agentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          agentName: formData.agentName,
          systemMessage: formData.systemMessage,
          userMessageTemplate: formData.userMessageTemplate,
          bufferWaitMs: formData.bufferWaitMs,
        }),
      })

      if (response.ok) {
        alert('Agente atualizado com sucesso!')
        setEditing(false)
        onUpdate(formData)
      }
    } catch (error) {
      console.error('Erro ao atualizar:', error)
      alert('Erro ao atualizar agente')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>{agent.agentName}</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onToggle}
            style={{
              padding: '8px 16px',
              background: agent.isActive ? '#ffc107' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {agent.isActive ? '⏸ Pausar' : '▶ Ativar'}
          </button>
          <button
            onClick={onDuplicate}
            style={{ padding: '8px 16px', background: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            📋 Duplicar
          </button>
          <button
            onClick={() => setEditing(!editing)}
            style={{ padding: '8px 16px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {editing ? '❌ Cancelar' : '✏️ Editar'}
          </button>
          <button
            onClick={onDelete}
            style={{ padding: '8px 16px', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            🗑️ Deletar
          </button>
        </div>
      </div>

      <div style={{ background: '#f8f9fa', padding: '16px', borderRadius: '6px', marginBottom: '16px' }}>
        <p><strong>ID:</strong> {agent.agentId}</p>
        <p><strong>Instância:</strong> {agent.instanceName}</p>
        <p><strong>Status:</strong> {agent.isActive ? '🟢 Ativo' : '🔴 Pausado'}</p>
        <p><strong>Criado em:</strong> {new Date(agent.createdAt).toLocaleString('pt-BR')}</p>
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Nome do Agente</label>
            <input
              type="text"
              value={formData.agentName}
              onChange={(e) => setFormData({ ...formData, agentName: e.target.value })}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Prompt do Sistema</label>
            <textarea
              value={formData.systemMessage}
              onChange={(e) => setFormData({ ...formData, systemMessage: e.target.value })}
              rows={10}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', fontFamily: 'monospace' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>Template de Mensagem</label>
            <textarea
              value={formData.userMessageTemplate}
              onChange={(e) => setFormData({ ...formData, userMessageTemplate: e.target.value })}
              rows={6}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', fontFamily: 'monospace' }}
            />
          </div>

          <button
            onClick={handleUpdate}
            style={{
              padding: '12px',
              background: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            💾 Salvar Alterações
          </button>
        </div>
      ) : (
        <div>
          <h3>Prompt do Sistema</h3>
          <pre style={{ background: '#f5f5f5', padding: '12px', borderRadius: '4px', whiteSpace: 'pre-wrap', fontSize: '12px' }}>
            {agent.systemMessage}
          </pre>

          <h3 style={{ marginTop: '24px' }}>Template de Mensagem</h3>
          <pre style={{ background: '#f5f5f5', padding: '12px', borderRadius: '4px', whiteSpace: 'pre-wrap', fontSize: '12px' }}>
            {agent.userMessageTemplate}
          </pre>
        </div>
      )}
    </div>
  )
}

// ─── Templates Padrão ─────────────────────────────────────────

const DEFAULT_SYSTEM_MESSAGE = `🎯 Regras Invioláveis do Consultor Virtual

Formato da Mensagem (OBRIGATÓRIO):
- Toda mensagem deve ter no máximo 120 caracteres.
- Use blocos curtos; adicione uma quebra de linha entre cada parágrafo.
- Construa mensagens objetivas, com textos curtos e impactantes.

Você é Bento, o consultor virtual especialista.

Tom de voz: Inspirador e envolvente.`

const DEFAULT_USER_MESSAGE_TEMPLATE = `Contexto do lead:
- Nome: {leadName}
- Telefone: {leadPhone}
- Voucher: {leadVoucher}
- Receita: {leadReceita}

Mensagens recebidas:
{allMessages}`
