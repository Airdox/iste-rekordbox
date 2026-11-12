import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CamelotWheel } from '../../src/camelot-wheel'
import { Empty, KeyBadge, LiveWaveform, MiniWave, Modal, Stars } from '../../src/components'

describe('components.tsx', () => {
  it('renders KeyBadge matched, unmatched and null states', () => {
    const { container, rerender } = render(<KeyBadge value={null} reference="8A" />)
    expect(container.querySelector('.muted')).toHaveTextContent('—')

    rerender(<KeyBadge value="8A" reference="9A" />)
    const matchBadge = container.querySelector('.keybadge')
    expect(matchBadge).toHaveTextContent('8A')
    expect(matchBadge).toHaveClass('match')

    rerender(<KeyBadge value="3B" reference="9A" />)
    const plainBadge = container.querySelector('.keybadge')
    expect(plainBadge).not.toHaveClass('match')

    rerender(<KeyBadge value="5A" />)
    expect(container.querySelector('.keybadge')).not.toHaveClass('match')
  })

  it('clamps Stars between 0 and 5 with accessible label', () => {
    const { rerender } = render(<Stars value={7.4} />)
    expect(screen.getByLabelText('5 von 5 Sternen')).toHaveTextContent('★★★★★')

    rerender(<Stars value={-2} />)
    expect(screen.getByLabelText('0 von 5 Sternen')).toHaveTextContent('☆☆☆☆☆')

    rerender(<Stars value={3} />)
    expect(screen.getByLabelText('3 von 5 Sternen')).toHaveTextContent('★★★☆☆')
  })

  it('renders deterministic MiniWave and LiveWaveform with sample data and synthetic fallback', () => {
    const { container, rerender } = render(<MiniWave trackId="trk-42" />)
    expect(container.querySelectorAll('svg.wfmini rect')).toHaveLength(32)

    rerender(<LiveWaveform samples={[0, 5, 18, 31, 12, 24]} seedId="trk-42" />)
    expect(screen.getByLabelText('Track-Analyse Waveform').querySelectorAll('rect').length).toBeGreaterThan(200)

    rerender(<LiveWaveform samples={[]} seedId="" />)
    expect(screen.getByLabelText('Track-Analyse Waveform').querySelectorAll('rect').length).toBeGreaterThan(200)
  })

  it('renders Empty state with default and custom icon', () => {
    const { rerender } = render(<Empty title="Leer">Beschreibung</Empty>)
    expect(screen.getByText('Leer')).toBeInTheDocument()
    expect(screen.getByText('Beschreibung')).toBeInTheDocument()

    rerender(<Empty icon={<span data-testid="custom-icon">*</span>} title="Custom" />)
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('handles Modal open/closed, backdrop click, Escape key and button actions', () => {
    const onClose = vi.fn()
    const onSave = vi.fn()

    const { rerender } = render(
      <Modal
        open={false}
        title="Dialog"
        onClose={onClose}
        actions={[{ label: 'Schließen' }]}
      >
        Inhalt
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(
      <Modal
        open
        wide
        title="Dialog"
        onClose={onClose}
        actions={[
          { label: 'Abbrechen' },
          { label: 'Speichern', primary: true, disabled: false, onClick: onSave },
        ]}
      >
        <div>Inhalt</div>
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('wide')

    // Click inside dialog should NOT close
    fireEvent.mouseDown(dialog)
    expect(onClose).not.toHaveBeenCalled()

    // Backdrop mouseDown closes
    fireEvent.mouseDown(dialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Non-Escape key does not close
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)

    // Escape closes
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)

    // Action without onClick falls back to onClose
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onClose).toHaveBeenCalledTimes(3)

    // Action with onClick calls handler without auto-closing
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})

describe('camelot-wheel.tsx', () => {
  it('renders 24 Camelot segments, handles single/additive clicks, keyboard activation and toggles', () => {
    const onToggleKey = vi.fn()
    const onSelectAllHarmonic = vi.fn()
    const onAutoFollowChange = vi.fn()
    const onIncludeCurrentChange = vi.fn()

    const { container, rerender } = render(
      <CamelotWheel
        referenceKey="8A"
        pinned={false}
        selectedKeys={['8A', '9A']}
        autoFollow
        includeCurrent={false}
        onToggleKey={onToggleKey}
        onSelectAllHarmonic={onSelectAllHarmonic}
        onAutoFollowChange={onAutoFollowChange}
        onIncludeCurrentChange={onIncludeCurrentChange}
      />,
    )

    expect(container.querySelectorAll('g[data-wheel-key]')).toHaveLength(24)
    expect(screen.getByText('Live-Referenz')).toBeInTheDocument()
    expect(screen.getByText('Aktive Keys: 8A, 9A')).toBeInTheDocument()

    // Segment click (non-additive vs Ctrl-additive)
    const seg8A = container.querySelector('g[data-wheel-key="8A"]')!
    fireEvent.click(seg8A, { ctrlKey: false })
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', false)

    fireEvent.click(seg8A, { ctrlKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    // Keyboard activation (Enter, Space, ignored other key)
    fireEvent.keyDown(seg8A, { key: 'Enter', shiftKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    fireEvent.keyDown(seg8A, { key: ' ', metaKey: true })
    expect(onToggleKey).toHaveBeenLastCalledWith('8A', true)

    fireEvent.keyDown(seg8A, { key: 'Tab' })
    expect(onToggleKey).toHaveBeenCalledTimes(4)

    // Quick chip click
    const chip9A = container.querySelector('.keychip[data-key="9A"]')!
    fireEvent.click(chip9A, { ctrlKey: false })
    expect(onToggleKey).toHaveBeenLastCalledWith('9A', false)

    // All harmonic button & checkboxes
    fireEvent.click(screen.getByRole('button', { name: 'Alle harmonisch passenden Keys wählen' }))
    expect(onSelectAllHarmonic).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('#autoFollow')!)
    expect(onAutoFollowChange).toHaveBeenCalledWith(false)

    fireEvent.click(container.querySelector('#includeCurrent')!)
    expect(onIncludeCurrentChange).toHaveBeenCalledWith(true)

    // Pinned & empty selectedKeys state
    rerender(
      <CamelotWheel
        referenceKey="8A"
        pinned
        selectedKeys={[]}
        autoFollow={false}
        includeCurrent
        onToggleKey={onToggleKey}
        onSelectAllHarmonic={onSelectAllHarmonic}
        onAutoFollowChange={onAutoFollowChange}
        onIncludeCurrentChange={onIncludeCurrentChange}
      />,
    )
    expect(screen.getByText('Fixierte Referenz')).toBeInTheDocument()
    expect(screen.getByText('Keine Keys gewählt – klicke ein Segment')).toBeInTheDocument()
  })
})
