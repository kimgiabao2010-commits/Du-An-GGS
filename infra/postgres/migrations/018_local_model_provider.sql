-- Additive provider compatibility; existing reservation bindings and cost semantics stay intact.
ALTER TABLE model_call_reservations DROP CONSTRAINT model_call_reservations_provider_check;
ALTER TABLE model_call_reservations ADD CONSTRAINT model_call_reservations_provider_check
  CHECK (provider IN ('openai','groq','llama.cpp'));
