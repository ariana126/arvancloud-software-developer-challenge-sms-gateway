Feature: High-volume senders

  Tens of thousands of businesses send through this gateway, and they do not send at the same
  rate: a few send enormously and most send a trickle. Left sharing one queue, the few would
  make the many wait.

  So the gateway classifies each customer by how much it is currently sending, and carries
  high-volume traffic separately from everyone else's. A customer can see which classification
  it falls into, and how close it is to the other one.

  Background:
    Given Ariana is a registered user

  Scenario: A customer sending very little shares capacity with the long tail
    When Ariana checks how her traffic is classified
    Then she is told her traffic shares capacity with other senders

  Scenario: A customer sending heavily is given capacity of its own
    Given Ariana has sent more SMS than the high-volume threshold
    When Ariana checks how her traffic is classified
    Then she is told her traffic is given capacity of its own

  Scenario: One customer's volume does not reclassify another customer
    Given Fateme is a registered user
    And Fateme has sent more SMS than the high-volume threshold
    When Ariana checks how her traffic is classified
    Then she is told her traffic shares capacity with other senders
