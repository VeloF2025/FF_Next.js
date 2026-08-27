package main

import (
	"context"
	"path/filepath"
	"testing"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/proto/waAdv"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

func TestConfigureWhatsAppClientUsesCallbackWithoutGlobalRetryMode(t *testing.T) {
	client := &whatsmeow.Client{}

	configureWhatsAppClient(client)

	if client.UseRetryMessageStore {
		t.Fatal("global retry mode triggers cleanup on every send in the pinned whatsmeow release")
	}
	if client.GetMessageForRetry == nil {
		t.Fatal("durable retry lookup callback must be configured")
	}
}

func TestPersistedDocumentCanBeRecoveredForRetry(t *testing.T) {
	ctx := context.Background()
	storePath := filepath.Join(t.TempDir(), "whatsapp.db")
	container, err := sqlstore.New(ctx, "sqlite3", "file:"+storePath+"?_foreign_keys=on", nil)
	if err != nil {
		t.Fatalf("create sql store: %v", err)
	}
	device := container.NewDevice()
	own := types.NewJID("27785687945", types.DefaultUserServer)
	device.ID = &own
	device.Account = &waAdv.ADVSignedDeviceIdentity{
		Details:             []byte{1},
		AccountSignature:    make([]byte, 64),
		AccountSignatureKey: make([]byte, 32),
		DeviceSignature:     make([]byte, 64),
	}
	if err = device.Save(ctx); err != nil {
		t.Fatalf("initialize device store: %v", err)
	}
	client := whatsmeow.NewClient(device, nil)
	configureWhatsAppClient(client)

	to := types.NewJID("120363421532174586", types.GroupServer)
	id := types.MessageID("TEST-DOCUMENT-ID")
	want := &waProto.Message{Conversation: proto.String("Mohadin report")}
	if err = persistMessageForRetry(client, to, id, want); err != nil {
		t.Fatalf("persist retry message: %v", err)
	}

	got := client.GetMessageForRetry(types.JID{}, to, id)
	if got == nil || got.GetConversation() != want.GetConversation() {
		t.Fatalf("retry lookup mismatch: got %#v", got)
	}
}
